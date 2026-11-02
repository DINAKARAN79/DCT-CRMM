export const BIZCALL_DIALPAD_WINDOW_NAME = "bizcall-dialpad";
export const DIALPAD_MONITOR_EVENT = "crm:bizcall-monitor-updated";

type DialpadLock = { ownerId?: string; heartbeatAt?: number } | null;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type DialerCommand =
  | { type: "INIT_USER"; userId: string }
  | { type: "DIAL"; number: string; recordId: string; leadName: string; taskId?: string; tenantId?: string }
  | { type: "BIZCALL_HANGUP" };

export type DialpadMonitorEntry = {
  direction: "command" | "event";
  time: string;
  name: string;
  tenantId: string;
  userId: string;
  leadId: string | null;
  fields: Record<string, string>;
};

const monitorListeners = new Set<() => void>();

export function buildBizcallNamespaceKey(tenantId: string, userId: string, purpose: "lock" | "channel" | "monitor") {
  return `bizcall:${tenantId}:${userId}:${purpose}`;
}

export function isTrustedBizcallMessage(
  messageOrigin: string,
  messageSource: unknown,
  expectedOrigin: string,
  expectedWindow: unknown,
) {
  return messageOrigin === expectedOrigin && messageSource === expectedWindow;
}

export function readDialpadLock(storage: StorageLike, key: string): DialpadLock {
  try {
    return JSON.parse(storage.getItem(key) || "null") as DialpadLock;
  } catch {
    return null;
  }
}

export function isDialpadLockStale(lock: DialpadLock, now: number, staleAfterMs = 5000) {
  return !lock?.ownerId || !lock.heartbeatAt || now - lock.heartbeatAt > staleAfterMs;
}

export function claimDialpadLock(storage: StorageLike, key: string, ownerId: string, now: number, staleAfterMs = 5000) {
  const current = readDialpadLock(storage, key);
  if (current?.ownerId !== ownerId && !isDialpadLockStale(current, now, staleAfterMs)) return false;
  try {
    storage.setItem(key, JSON.stringify({ ownerId, heartbeatAt: now }));
    return readDialpadLock(storage, key)?.ownerId === ownerId;
  } catch {
    return false;
  }
}

export function buildBizcallDialpadUrl(url: string, userId: string, theme: "CRM" | "LIGHT" | "DARK") {
  const dialpadUrl = new URL(url);
  dialpadUrl.searchParams.set("userId", userId);
  dialpadUrl.searchParams.set("theme", theme.toLowerCase() === "crm" ? "light" : theme.toLowerCase());
  return dialpadUrl.toString();
}

export function openBizcallDialpad(
  url: string,
  userId: string,
  tenantId: string,
  theme: "CRM" | "LIGHT" | "DARK",
  openWindow: (url: string, target: string) => unknown,
) {
  const targetName = `${BIZCALL_DIALPAD_WINDOW_NAME}-${encodeURIComponent(tenantId)}-${encodeURIComponent(userId)}`;
  return openWindow(buildBizcallDialpadUrl(url, userId, theme), targetName);
}

export function maskDialpadNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (normalized.length < 5) return "••••";
  return `${normalized.slice(0, Math.min(3, normalized.length - 4))}${"•".repeat(Math.max(4, normalized.length - 7))}${normalized.slice(-4)}`;
}

function maskDialpadEmail(value: string) {
  const [local, domain] = value.split("@");
  return local && domain ? `${local.slice(0, 1)}•••@${domain}` : "[redacted]";
}

export function sanitizeDialpadFields(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).slice(0, 40).map(([key, value]) => {
    const safeKey = key.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
    if (/notes?/i.test(key)) return [safeKey, "[redacted]"];
    if (/token|secret|password|credential|authorization|api.?key|hash/i.test(key)) return [safeKey, "[redacted]"];
    if (/number|phone/i.test(key)) return [safeKey, maskDialpadNumber(value)];
    if (typeof value === "string" && value.includes("@")) return [safeKey, maskDialpadEmail(value)];
    if (typeof value === "string" && /^\+[1-9]\d{1,14}$/.test(value)) {
      return [safeKey, maskDialpadNumber(value)];
    }
    if (typeof value === "string") return [safeKey, value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200)];
    if (typeof value === "number" && Number.isFinite(value)) return [safeKey, String(value)];
    if (typeof value === "boolean") return [safeKey, String(value)];
    return [safeKey, "[omitted]"];
  }));
}

export function sendDialerCommand(
  target: Pick<Window, "postMessage"> | null | undefined,
  targetOrigin: string,
  iframeLoaded: boolean,
  command: DialerCommand,
): { ok: boolean; reason?: "IFRAME_NOT_READY" | "INVALID_COMMAND" | "INVALID_ORIGIN" } {
  if (!iframeLoaded || !target) return { ok: false, reason: "IFRAME_NOT_READY" };
  let origin: string;
  try {
    origin = new URL(targetOrigin).origin;
  } catch {
    return { ok: false, reason: "INVALID_ORIGIN" };
  }
  if (origin !== targetOrigin || origin === "*" || origin === "null") return { ok: false, reason: "INVALID_ORIGIN" };
  if (command.type === "INIT_USER" && !command.userId.trim()) return { ok: false, reason: "INVALID_COMMAND" };
  if (command.type === "DIAL" && (
    !/^\+[1-9]\d{1,14}$/.test(command.number)
    || !command.recordId.trim()
    || !command.leadName.trim()
    || (command.taskId !== undefined && !command.taskId.trim())
  )) return { ok: false, reason: "INVALID_COMMAND" };
  target.postMessage(command, origin);
  return { ok: true };
}

export function recordDialpadMonitorEntry(
  tenantId: string,
  userId: string,
  entry: Omit<DialpadMonitorEntry, "time" | "tenantId" | "userId" | "fields"> & { fields: Record<string, unknown> },
) {
  const safeEntry: DialpadMonitorEntry = {
    ...entry,
    time: new Date().toISOString(),
    tenantId,
    userId,
    fields: sanitizeDialpadFields(entry.fields),
  };
  try {
    const key = buildBizcallNamespaceKey(tenantId, userId, "monitor");
    const current = JSON.parse(window.sessionStorage.getItem(key) || "[]") as DialpadMonitorEntry[];
    window.sessionStorage.setItem(key, JSON.stringify([...current, safeEntry].slice(-50)));
    window.dispatchEvent(new CustomEvent(DIALPAD_MONITOR_EVENT));
  } catch {
    // Monitoring is diagnostic only; storage can be disabled by browser policy.
  }
}

export function readDialpadMonitorEntries(tenantId: string, userId: string): DialpadMonitorEntry[] {
  try {
    const entries = JSON.parse(window.sessionStorage.getItem(buildBizcallNamespaceKey(tenantId, userId, "monitor")) || "[]");
    return Array.isArray(entries) ? entries.slice(-50) : [];
  } catch {
    return [];
  }
}

export function subscribeDialpadMonitor(listener: () => void) {
  monitorListeners.add(listener);
  const onUpdate = () => {
    monitorListeners.forEach((current) => current());
  };
  if (typeof window !== "undefined") window.addEventListener(DIALPAD_MONITOR_EVENT, onUpdate);
  return () => {
    monitorListeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener(DIALPAD_MONITOR_EVENT, onUpdate);
  };
}
