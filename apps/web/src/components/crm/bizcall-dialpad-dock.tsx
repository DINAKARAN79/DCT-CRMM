"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Phone, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { clickToCallApi } from "@/lib/api";
import { buildBizcallDialpadUrl, BIZCALL_DIALPAD_WINDOW_NAME, claimDialpadLock, isDialpadLockStale, isTrustedBizcallMessage, openBizcallDialpad, readDialpadLock } from "@/lib/bizcall-dialpad";
import { placeLeadCall, type ClickToCallOutcome } from "@/lib/click-to-call";
import { registerTelephonyDialHandler, setTelephonyNumberMasking, setTelephonyStatus } from "@/lib/telephony-client";
import { Button } from "@/components/ui/button";

type DialpadConfig = {
  active: boolean;
  dialpadUrl: string;
  dialpadOrigin: string;
  dialpadMode: "DOCKED" | "NEW_TAB";
  callMethod: "SERVER_API" | "DIALPAD_MESSAGE";
  theme: "CRM" | "LIGHT" | "DARK";
  defaultDockState: "COLLAPSED" | "EXPANDED";
  maskNumbers: boolean;
};

type DialRequest = { leadId: string; phoneField: "phone" | "mobile" | "secondaryPhone"; leadName: string };
type MessageData = { type?: unknown; extension?: unknown; callUuid?: unknown; duration?: unknown; disposition?: unknown; notes?: unknown };

const LOCK_HEARTBEAT_MS = 2_000;
const LOCK_STALE_MS = 5_000;

function outcome(ok: boolean, code: string, message: string, step: ClickToCallOutcome["step"] = "blocked_before_send", callDetailId: string | null = null): ClickToCallOutcome {
  return { ok, code, message, step, ignored: false, callDetailId, leadStatus: null, statusChanged: false, leadName: null };
}

function safeText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";
}

function dialpadUrlFor(config: DialpadConfig, userId: string) {
  return buildBizcallDialpadUrl(config.dialpadUrl, userId, config.theme);
}

function openDialpadTab(config: DialpadConfig, userId: string) {
  return openBizcallDialpad(config.dialpadUrl, userId, config.theme, (url, target) => window.open(url, target));
}

export function BizcallDialpadDock() {
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated, isAdmin, isSuperAdmin, hasEffectivePermission } = useAuth();
  const showOnPage = !pathname.startsWith("/setup") || pathname === "/setup/integrations/telephony";
  const allowed = hasEffectivePermission("TELEPHONY_CALL");
  const [config, setConfig] = React.useState<DialpadConfig | null>(null);
  const [reasonCode, setReasonCode] = React.useState("NOT_CONFIGURED");
  const [secureTransport, setSecureTransport] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  const [online, setOnline] = React.useState(false);
  const [extension, setExtension] = React.useState("");
  const [callState, setCallState] = React.useState("Connecting");
  const [activeCall, setActiveCall] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");
  const [pendingRequest, setPendingRequest] = React.useState<DialRequest | null>(null);
  const [ownsLock, setOwnsLock] = React.useState(false);
  const [otherTab, setOtherTab] = React.useState(false);
  const [takingOver, setTakingOver] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [iframeGeneration, setIframeGeneration] = React.useState(0);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const onlineRef = React.useRef(false);
  const waiterRef = React.useRef<(() => void) | null>(null);
  const configRef = React.useRef<DialpadConfig | null>(null);
  const userIdRef = React.useRef(user?.id || "");
  const tabIdRef = React.useRef("");
  const lockOwnerRef = React.useRef(false);
  const dockedDialpadUrl = config?.dialpadMode === "DOCKED" ? config.dialpadUrl : null;
  const lockEnabled = Boolean(config?.active && config.dialpadMode === "DOCKED");

  React.useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  React.useEffect(() => {
    configRef.current = config;
  }, [config]);
  React.useEffect(() => {
    userIdRef.current = user?.id || "";
  }, [user?.id]);

  React.useEffect(() => {
    setTelephonyStatus(
      Boolean(isAuthenticated && allowed && config?.active),
      !isAuthenticated ? "NOT_CONFIGURED" : !allowed ? "NO_PERMISSION" : config?.active ? "ACTIVE" : reasonCode,
    );
    setTelephonyNumberMasking(Boolean(isAuthenticated && allowed && config?.active && config.maskNumbers));
    return () => {
      setTelephonyStatus(false, "NOT_CONFIGURED");
      setTelephonyNumberMasking(false);
    };
  }, [allowed, config?.active, config?.maskNumbers, isAuthenticated, reasonCode]);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname.toLowerCase();
      const isLocal = process.env.NODE_ENV !== "production" && (
        hostname === "localhost" || hostname === "::1" ||
        (hostname.split(".").length === 4 && Number(hostname.split(".")[0]) === 127)
      );
      setSecureTransport(window.location.protocol === "https:" || isLocal);
    }
    if (isLoading) return;
    if (!isAuthenticated) {
      setConfig(null);
      setOnline(false);
      setReasonCode("NOT_CONFIGURED");
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const response = await clickToCallApi.clientConfig();
        if (!active) return;
        const data = response.data.data as DialpadConfig & { reasonCode?: string };
        if (data?.active && data.dialpadUrl && new URL(data.dialpadUrl).origin === data.dialpadOrigin) {
          setConfig(data);
            setReasonCode("ACTIVE");
            if (!configRef.current) setExpanded(data.defaultDockState === "EXPANDED");
        } else {
            setConfig(null);
            setOnline(false);
            setReasonCode(data?.reasonCode || "CONFIG_UNAVAILABLE");
        }
      } catch (error: unknown) {
        if (active) {
            setConfig(null);
            setOnline(false);
            const responseCode = error && typeof error === "object" && "response" in error
              ? (error as { response?: { data?: { code?: string } } }).response?.data?.code
              : undefined;
            setReasonCode(responseCode === "TELEPHONY_CONFIG_UNAVAILABLE" ? "SETTINGS_UNAVAILABLE" : "PROXY_UNAVAILABLE");
        }
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [isAuthenticated, isLoading]);

  React.useEffect(() => {
    if (!lockEnabled || !user?.id || !showOnPage) {
      setOwnsLock(false);
      setOtherTab(false);
      return;
    }
    const key = `bizcall-dialpad-lock:${user.id}`;
    const tabId = tabIdRef.current || (tabIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`bizcall-dialpad:${user.id}`) : null;
    const setOwnership = (owns: boolean) => {
      lockOwnerRef.current = owns;
      setOwnsLock(owns);
      setOtherTab(!owns);
      if (owns) setTakingOver(false);
    };
    const getLock = () => readDialpadLock(localStorage, key);
    const claimOrHeartbeat = () => {
      const current = getLock();
      const stale = isDialpadLockStale(current, Date.now(), LOCK_STALE_MS);
      if (current?.ownerId === tabId || stale) {
        const acquired = claimDialpadLock(localStorage, key, tabId, Date.now(), LOCK_STALE_MS);
        setOwnership(acquired);
        if (acquired) channel?.postMessage({ type: "heartbeat", ownerId: tabId, heartbeatAt: Date.now() });
        if (!acquired) setStatusMessage("Cross-tab protection is unavailable. Use one CRM tab for the dialpad.");
        return acquired;
      }
      setOwnership(false);
      return false;
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const current = getLock();
      if (current?.ownerId !== tabId) setOwnership(false);
      else setOwnership(true);
    };
    const releaseOnPageHide = () => {
      if (getLock()?.ownerId === tabId) {
        localStorage.removeItem(key);
        channel?.postMessage({ type: "released", ownerId: tabId });
      }
    };
    const onBroadcast = (event: MessageEvent<{ type?: string; ownerId?: string; requesterId?: string }>) => {
      const message = event.data;
      if (message?.type === "takeover" && lockOwnerRef.current && message.requesterId && message.requesterId !== tabId) {
        const current = getLock();
        if (current?.ownerId === tabId) localStorage.removeItem(key);
        channel?.postMessage({ type: "released", ownerId: tabId });
        setOwnership(false);
        return;
      }
      if (["heartbeat", "released"].includes(message?.type || "") && message.ownerId !== tabId) {
        const current = getLock();
        if (current?.ownerId !== tabId) setOwnership(false);
      }
    };
    setOwnership(claimOrHeartbeat());
    const heartbeatTimer = window.setInterval(() => {
      if (lockOwnerRef.current || isDialpadLockStale(getLock(), Date.now(), LOCK_STALE_MS)) claimOrHeartbeat();
    }, LOCK_HEARTBEAT_MS);
    const staleLockTimer = window.setInterval(() => {
      if (!lockOwnerRef.current && isDialpadLockStale(getLock(), Date.now(), LOCK_STALE_MS)) claimOrHeartbeat();
    }, 250);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", releaseOnPageHide);
    channel?.addEventListener("message", onBroadcast);
    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(staleLockTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", releaseOnPageHide);
      try {
        if (getLock()?.ownerId === tabId) localStorage.removeItem(key);
      } catch { /* local storage can be disabled by browser policy */ }
      channel?.removeEventListener("message", onBroadcast);
      channel?.close();
      lockOwnerRef.current = false;
    };
  }, [lockEnabled, showOnPage, user?.id]);

  React.useEffect(() => {
    if (!dockedDialpadUrl || !ownsLock || !showOnPage) return;
    onlineRef.current = false;
    setOnline(false);
    setBlocked(false);
    setCallState("Connecting");
    const timer = window.setTimeout(() => {
      if (onlineRef.current) return;
      setBlocked(true);
      setCallState("Blocked");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [dockedDialpadUrl, iframeGeneration, ownsLock, showOnPage]);

  const waitUntilOnline = React.useCallback(async () => {
    if (onlineRef.current) return true;
    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        waiterRef.current = null;
        resolve(false);
      }, 5000);
      waiterRef.current = () => {
        window.clearTimeout(timeout);
        waiterRef.current = null;
        resolve(true);
      };
    });
  }, []);

  const placeRequest = React.useCallback(async (request: DialRequest): Promise<ClickToCallOutcome> => {
    const currentConfig = configRef.current;
    if (!currentConfig?.active) return outcome(false, "TELEPHONY_NOT_CONFIGURED", "Telephony is not active for this company.");
    if (activeCall && !window.confirm("A call may still be in progress. Start another call anyway?")) {
      return outcome(false, "CALL_IN_PROGRESS", "The current call is still in progress.");
    }
    if (currentConfig.dialpadMode === "DOCKED" && !ownsLock) {
      setOtherTab(true);
      return outcome(false, "DIALPAD_IN_ANOTHER_TAB", "Dialpad is active in another CRM tab.");
    }
    if (currentConfig.dialpadMode === "NEW_TAB" && currentConfig.callMethod === "DIALPAD_MESSAGE") {
      return outcome(false, "DIALPAD_MESSAGE_UNAVAILABLE", "Dialpad message mode requires the docked panel. Switch to Docked panel in Telephony settings.");
    }
    setPendingRequest(request);
    setExpanded(true);
    setStatusMessage("");
    if (currentConfig.dialpadMode === "NEW_TAB") {
      openDialpadTab(currentConfig, userIdRef.current);
    }
    if (currentConfig.callMethod === "SERVER_API") {
      if (currentConfig.dialpadMode === "DOCKED" && (!onlineRef.current || blocked)) {
        setBusy(false);
        return outcome(false, "DIALPAD_BLOCKED", "Bizcall did not allow this site to embed the dialpad. Open the dialpad in a new tab or ask Bizcall to allow this CRM origin.");
      }
      setBusy(true);
      const result = await placeLeadCall(request.leadId, request.phoneField);
      setBusy(false);
      if (result.ok) {
        setActiveCall(true);
        setCallState("Calling");
        if (currentConfig.dialpadMode === "NEW_TAB") setStatusMessage("Keep the Bizcall dialpad tab open and allow the microphone.");
      }
      return result;
    }
    setBusy(true);
    const isOnline = await waitUntilOnline();
    if (!isOnline) {
      setBusy(false);
      setBlocked(true);
      setCallState("Blocked");
      return outcome(false, "DIALPAD_BLOCKED", "Bizcall did not allow this site to embed the dialpad. Open the dialpad in a new tab or ask Bizcall to allow this CRM origin.");
    }
    try {
      const response = await clickToCallApi.dialpadCallStarted({ leadId: request.leadId, phoneField: request.phoneField });
      const data = response.data.data as { callDetailId: string; leadId: string; leadName: string; dialNumber: string };
      const target = frameRef.current?.contentWindow;
      if (!target || !data.dialNumber) {
        setBusy(false);
        return outcome(false, "DIALPAD_NOT_READY", "The dialpad is not ready to place this call.");
      }
      target.postMessage({
        type: "DIAL",
        number: data.dialNumber,
        recordId: data.leadId,
        leadName: safeText(data.leadName || request.leadName, 200),
      }, currentConfig.dialpadOrigin);
      setActiveCall(true);
      window.dispatchEvent(new CustomEvent("crm:call-details-updated", { detail: { leadId: request.leadId } }));
      setBusy(false);
      return outcome(true, "INITIATED", "Calling through the Bizcall dialpad.", "sent_to_provider", data.callDetailId);
    } catch (error) {
      setBusy(false);
      const body = (error as { response?: { data?: { message?: string } } })?.response?.data;
      return outcome(false, "DIALPAD_CALL_FAILED", body?.message || "The call could not be started.");
    }
  }, [activeCall, blocked, ownsLock, waitUntilOnline]);

  React.useEffect(() => registerTelephonyDialHandler(placeRequest), [placeRequest]);

  React.useEffect(() => {
    const currentConfig = configRef.current;
    if (!currentConfig || !frameRef.current || !ownsLock || blocked || !showOnPage) return;
    const frameWindow = frameRef.current.contentWindow;
    const onMessage = (event: MessageEvent<MessageData>) => {
      if (!isTrustedBizcallMessage(event.origin, event.source, currentConfig.dialpadOrigin, frameWindow) || !event.data || typeof event.data.type !== "string") return;
      const message = event.data;
      if (message.type === "BIZCALL_AGENT_REGISTERED") {
        onlineRef.current = true;
        setOnline(true);
        setBlocked(false);
        setCallState("ONLINE");
        setExtension(safeText(message.extension, 40));
        setStatusMessage("");
        waiterRef.current?.();
        return;
      }
      const type = safeText(message.type, 80);
      if (!["BIZCALL_CALL_STARTING", "BIZCALL_CALL_CONNECTED", "BIZCALL_CALL_ENDED", "BIZCALL_DISPOSITION_SUBMITTED"].includes(type)) return;
      const request = pendingRequest;
      if (!request) return;
      if (type === "BIZCALL_CALL_STARTING") { setCallState("Calling"); setActiveCall(true); }
      if (type === "BIZCALL_CALL_CONNECTED") { setCallState("Connected"); setActiveCall(true); }
      if (type === "BIZCALL_CALL_ENDED") { setCallState("ONLINE"); setActiveCall(false); }
      void clickToCallApi.dialpadEvent({
        callUuid: safeText(message.callUuid, 255) || undefined,
        leadId: request.leadId,
        type,
        duration: typeof message.duration === "number" && Number.isFinite(message.duration) ? Math.max(0, Math.min(86_400, Math.floor(message.duration))) : undefined,
        disposition: safeText(message.disposition, 120) || undefined,
        notes: safeText(message.notes, 2000) || undefined,
      }).then(() => window.dispatchEvent(new CustomEvent("crm:call-details-updated", { detail: { leadId: request.leadId } })))
        .catch(() => setStatusMessage("Call event could not be saved. Refresh Call Details and try again."));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [blocked, config, iframeGeneration, ownsLock, pendingRequest, showOnPage]);

  const resetDialpad = () => {
    onlineRef.current = false;
    setOnline(false);
    setBlocked(false);
    setCallState("Connecting");
    setStatusMessage("");
    setIframeGeneration((generation) => generation + 1);
  };

  const takeOverHere = () => {
    if (!user?.id) return;
    setTakingOver(true);
    setExpanded(true);
    const key = `bizcall-dialpad-lock:${user.id}`;
    try {
      const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`bizcall-dialpad:${user.id}`) : null;
      channel?.postMessage({ type: "takeover", requesterId: tabIdRef.current });
      const acquired = claimDialpadLock(localStorage, key, tabIdRef.current, Date.now(), LOCK_STALE_MS);
      lockOwnerRef.current = acquired;
      setOwnsLock(acquired);
      setOtherTab(!acquired);
      if (!acquired) {
        const retryTakeover = (attempt: number) => window.setTimeout(() => {
          try {
            const tookOver = claimDialpadLock(localStorage, key, tabIdRef.current, Date.now(), LOCK_STALE_MS);
            lockOwnerRef.current = tookOver;
            setOwnsLock(tookOver);
            setOtherTab(!tookOver);
            if (!tookOver && attempt < 24) {
              retryTakeover(attempt + 1);
              return;
            }
          } catch {
            setStatusMessage("Could not take over the dialpad in this browser.");
          }
          setTakingOver(false);
        }, 200);
        retryTakeover(0);
      } else {
        setTakingOver(false);
      }
      channel?.close();
    } catch {
      setTakingOver(false);
      setStatusMessage("Could not take over the dialpad in this browser.");
    }
  };

  if (isLoading || !isAuthenticated || !allowed || !config?.active || !showOnPage) return null;
  if (!secureTransport) {
    return (
      <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg dark:bg-amber-950 dark:text-amber-100">
        Calls need HTTPS. Microphone access is blocked on plain HTTP.
      </div>
    );
  }
  if (config.dialpadMode === "NEW_TAB") {
    return (
      <div className="fixed bottom-4 right-4 z-40 rounded-lg border bg-background p-3 text-xs shadow-lg">
        <p>Keep the Bizcall dialpad tab open and allow the microphone.</p>
        <Button className="mt-2" size="sm" onClick={() => openDialpadTab(config, user?.id || "")}>Open dialpad in a new tab</Button>
      </div>
    );
  }
  if (otherTab) {
    return (
      <div className="fixed bottom-4 right-4 z-40 rounded-lg border bg-background p-3 text-sm shadow-lg">
        <p>Dialpad is active in another CRM tab</p>
        <Button className="mt-2" size="sm" disabled={takingOver} onClick={takeOverHere}>{takingOver ? "Taking over…" : "Use dialpad here"}</Button>
      </div>
    );
  }
  if (!ownsLock && config.dialpadMode === "DOCKED") {
    return <div className="fixed bottom-4 right-4 z-40 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg">Connecting to the Bizcall dialpad…</div>;
  }

  const dialpadUrl = dialpadUrlFor(config, user?.id || "");
  const crmOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <aside className="fixed bottom-3 right-3 z-50 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-background shadow-2xl md:bottom-4 md:right-4">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
          <span>Bizcall Dialpad</span>
          <span className="text-xs font-normal text-muted-foreground">{extension ? `· ${extension} · ${callState}` : `· ${callState}`}</span>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={expanded ? "Minimize dialpad" : "Expand dialpad"} onClick={() => setExpanded((value) => !value)}>
            <Phone className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Reload dialpad" onClick={resetDialpad}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div className={expanded ? "block" : "h-0 overflow-hidden"}>
        {statusMessage ? <div className="bg-amber-50 px-3 py-2 text-xs text-amber-900">{statusMessage}</div> : null}
        {busy ? <p className="px-3 py-1 text-xs text-muted-foreground">Preparing call…</p> : null}
        {blocked ? (
          <div className="space-y-3 p-4 text-sm">
            <p className="font-medium">Bizcall did not allow this site to embed the dialpad.</p>
            {(isAdmin || isSuperAdmin) && crmOrigin ? <p className="break-all text-muted-foreground">Ask Bizcall to allow this origin in frame-ancestors: <code>{crmOrigin}</code></p> : null}
            <Button className="w-full" onClick={() => openDialpadTab(config, user?.id || "")}>Open dialpad in a new tab</Button>
          </div>
        ) : (
          <iframe
            key={iframeGeneration}
            ref={frameRef}
            id={BIZCALL_DIALPAD_WINDOW_NAME}
            src={dialpadUrl}
            title="Bizcall dialpad"
            allow="microphone; autoplay"
            width={360}
            height={620}
            className="h-[min(620px,calc(100dvh-6rem))] w-full border-0"
            onError={() => {
              onlineRef.current = false;
              setOnline(false);
              setBlocked(true);
              setCallState("Blocked");
            }}
          />
        )}
      </div>
    </aside>
  );
}
