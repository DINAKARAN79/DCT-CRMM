import { describe, expect, it, vi } from "vitest";
import {
  BIZCALL_DIALPAD_WINDOW_NAME,
  buildBizcallDialpadUrl,
  buildBizcallNamespaceKey,
  claimDialpadLock,
  isDialpadLockStale,
  isTrustedBizcallMessage,
  openBizcallDialpad,
  maskDialpadNumber,
  sanitizeDialpadFields,
  sendDialerCommand,
} from "./bizcall-dialpad";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("Bizcall dialpad browser helpers", () => {
  it("isolates locks, channels, and monitor storage by tenant and user", () => {
    expect(buildBizcallNamespaceKey("tenant-a", "user-1", "lock")).not.toBe(
      buildBizcallNamespaceKey("tenant-b", "user-1", "lock"),
    );
    expect(buildBizcallNamespaceKey("tenant-a", "user-1", "channel")).not.toBe(
      buildBizcallNamespaceKey("tenant-a", "user-2", "channel"),
    );
    expect(buildBizcallNamespaceKey("tenant-a", "user-1", "monitor")).toBe("bizcall:tenant-a:user-1:monitor");
  });

  it("expires a closed tab's heartbeat after five seconds and lets another tab take over", () => {
    const storage = memoryStorage();
    storage.setItem("lock", JSON.stringify({ ownerId: "closed-tab", heartbeatAt: 1000 }));

    expect(isDialpadLockStale({ ownerId: "closed-tab", heartbeatAt: 1000 }, 6000)).toBe(false);
    expect(claimDialpadLock(storage, "lock", "other-tab", 6001)).toBe(true);
    expect(JSON.parse(storage.getItem("lock") || "{}")).toMatchObject({ ownerId: "other-tab", heartbeatAt: 6001 });
  });

  it("does not claim a fresh heartbeat until the owner releases it", () => {
    const storage = memoryStorage();
    storage.setItem("lock", JSON.stringify({ ownerId: "current-tab", heartbeatAt: 1000 }));
    expect(claimDialpadLock(storage, "lock", "other-tab", 2000)).toBe(false);
    expect(JSON.parse(storage.getItem("lock") || "{}").ownerId).toBe("current-tab");
  });

  it("builds the same identity-scoped dialpad tab URL with the CRM user and theme", () => {
    const openWindow = vi.fn();
    const url = "https://bizcall.cxteletech.com/embed/dialpad?existing=value";
    openBizcallDialpad(url, "crm-user-42", "tenant-1", "DARK", openWindow);
    openBizcallDialpad(url, "crm-user-42", "tenant-1", "DARK", openWindow);
    openBizcallDialpad(url, "crm-user-42", "tenant-2", "DARK", openWindow);

    expect(openWindow).toHaveBeenCalledTimes(3);
    expect(openWindow).toHaveBeenNthCalledWith(
      1,
      "https://bizcall.cxteletech.com/embed/dialpad?existing=value&userId=crm-user-42&theme=dark",
      `${BIZCALL_DIALPAD_WINDOW_NAME}-tenant-1-crm-user-42`,
    );
    expect(openWindow.mock.calls[0][1]).toBe(openWindow.mock.calls[1][1]);
    expect(openWindow.mock.calls[0][1]).not.toBe(openWindow.mock.calls[2][1]);
  });

  it("serializes CRM theme as light and includes the required user id", () => {
    const result = new URL(buildBizcallDialpadUrl(
      "https://bizcall.cxteletech.com/embed/dialpad",
      "crm-user-7",
      "CRM",
    ));
    expect(result.searchParams.get("userId")).toBe("crm-user-7");
    expect(result.searchParams.get("theme")).toBe("light");
  });

  it("rejects messages from other origins or other windows", () => {
    const dialpadWindow = {};
    expect(isTrustedBizcallMessage("https://bizcall.cxteletech.com", dialpadWindow, "https://bizcall.cxteletech.com", dialpadWindow)).toBe(true);
    expect(isTrustedBizcallMessage("https://attacker.example", dialpadWindow, "https://bizcall.cxteletech.com", dialpadWindow)).toBe(false);
    expect(isTrustedBizcallMessage("https://bizcall.cxteletech.com", {}, "https://bizcall.cxteletech.com", dialpadWindow)).toBe(false);
  });

  it("sends the documented INIT, DIAL, and HANGUP shapes only to the configured origin", () => {
    const target = { postMessage: vi.fn() };
    const origin = "https://bizcall.cxteletech.com";
    expect(sendDialerCommand(target, origin, true, { type: "INIT_USER", userId: "agent-1" })).toEqual({ ok: true });
    expect(sendDialerCommand(target, origin, true, {
      type: "DIAL",
      number: "+14155552671",
      recordId: "lead-1",
      leadName: "Lead One",
      taskId: "followup-1",
      tenantId: "tenant-1",
    })).toEqual({ ok: true });
    expect(sendDialerCommand(target, origin, true, { type: "BIZCALL_HANGUP" })).toEqual({ ok: true });
    expect(target.postMessage.mock.calls).toEqual([
      [{ type: "INIT_USER", userId: "agent-1" }, origin],
      [{
        type: "DIAL",
        number: "+14155552671",
        recordId: "lead-1",
        leadName: "Lead One",
        taskId: "followup-1",
        tenantId: "tenant-1",
      }, origin],
      [{ type: "BIZCALL_HANGUP" }, origin],
    ]);
  });

  it("refuses commands until loaded and rejects unsafe origins or invalid dial payloads", () => {
    const target = { postMessage: vi.fn() };
    expect(sendDialerCommand(target, "https://bizcall.cxteletech.com", false, {
      type: "INIT_USER",
      userId: "agent-1",
    })).toMatchObject({ ok: false, reason: "IFRAME_NOT_READY" });
    expect(sendDialerCommand(target, "*", true, { type: "BIZCALL_HANGUP" })).toMatchObject({ ok: false, reason: "INVALID_ORIGIN" });
    expect(sendDialerCommand(target, "https://bizcall.cxteletech.com", true, {
      type: "DIAL",
      number: "4155552671",
      recordId: "",
      leadName: "",
    })).toMatchObject({ ok: false, reason: "INVALID_COMMAND" });
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it("masks phone numbers and redacts notes before monitor storage", () => {
    expect(maskDialpadNumber("+14155552671")).toBe("+14•••••2671");
    expect(sanitizeDialpadFields({
      number: "+14155552671",
      notes: "private call notes",
      extension: "101",
      unknown: { secret: "value" },
      email: "agent@example.com",
      accessToken: "secret-token",
      caller: "+14155552671",
    })).toEqual({
      number: "+14•••••2671",
      notes: "[redacted]",
      extension: "101",
      unknown: "[omitted]",
      email: "a•••@example.com",
      accessToken: "[redacted]",
      caller: "+14•••••2671",
    });
  });
});
