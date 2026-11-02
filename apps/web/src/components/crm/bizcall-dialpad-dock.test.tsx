import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dockMocks = vi.hoisted(() => ({
  clientConfig: vi.fn(),
  placeLeadCall: vi.fn(),
  dialHandler: undefined as undefined | ((request: { leadId: string; phoneField: "phone"; leadName: string }) => Promise<unknown>),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/leads" }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: "agent-1" },
    isLoading: false,
    isAuthenticated: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasEffectivePermission: () => true,
  }),
}));
vi.mock("@/lib/api", () => ({
  clickToCallApi: {
    clientConfig: dockMocks.clientConfig,
    dialpadCallStarted: vi.fn(),
    dialpadEvent: vi.fn(),
  },
}));
vi.mock("@/lib/click-to-call", () => ({
  placeLeadCall: dockMocks.placeLeadCall,
}));
vi.mock("@/lib/telephony-client", () => ({
  registerTelephonyDialHandler: (handler: typeof dockMocks.dialHandler) => {
    dockMocks.dialHandler = handler;
    return () => { dockMocks.dialHandler = undefined; };
  },
  setTelephonyStatus: vi.fn(),
  setTelephonyNumberMasking: vi.fn(),
}));

import { BizcallDialpadDock } from "./bizcall-dialpad-dock";

describe("BizcallDialpadDock blocked state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    dockMocks.clientConfig.mockReset().mockResolvedValue({
      data: {
        data: {
          active: true,
          dialpadUrl: "https://bizcall.cxteletech.com/embed/dialpad",
          dialpadOrigin: "https://bizcall.cxteletech.com",
          dialpadMode: "DOCKED",
          callMethod: "SERVER_API",
          theme: "CRM",
          defaultDockState: "EXPANDED",
          maskNumbers: false,
        },
      },
    });
    dockMocks.placeLeadCall.mockReset();
    dockMocks.dialHandler = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows Blocked after no registration and prevents a docked server call", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<BizcallDialpadDock />);
      await Promise.resolve();
    });
    expect(screen.getByTitle("Bizcall dialpad")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText("Bizcall did not allow this site to embed the dialpad.")).toBeInTheDocument();
    expect(screen.getByText("· Blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open dialpad in a new tab" })).toBeInTheDocument();

    await act(async () => {
      await dockMocks.dialHandler?.({ leadId: "lead-1", phoneField: "phone", leadName: "Lead One" });
    });
    expect(dockMocks.placeLeadCall).not.toHaveBeenCalled();
  });
});
