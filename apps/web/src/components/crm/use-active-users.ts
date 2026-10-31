"use client";

import * as React from "react";
import { getSessionToken, presenceApi } from "@/lib/api";

export type PresenceConnection = "live" | "reconnecting";

type SessionRow = {
  id: string;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
};

type ActiveUser = {
  id: string;
  firstName: string;
  lastName: string;
  profile: { name: string } | null;
  role: { name: string } | null;
  sessionCount: number;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  loggedInSince: string | null;
  lastActivity: string | null;
  isLoggedIn: boolean;
  sessions: SessionRow[];
};

export type ActiveUsersPayload = {
  onlineCount: number;
  totalUsers: number;
  loggedOut: number;
  byProfile: Array<{ profile: string; count: number }>;
  users: ActiveUser[];
  detailsHidden?: boolean;
};

type ActiveUsersParams = {
  search?: string;
  includeOffline?: boolean;
};

function streamUrl() {
  const params = new URLSearchParams();
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/setup")) {
    const tenantId = new URLSearchParams(window.location.search).get("tenantId");
    if (tenantId) params.set("tenantId", tenantId);
  }
  const query = params.toString();
  return `/api/proxy/api/admin/active-users/stream${query ? `?${query}` : ""}`;
}

export function useActiveUsers(params: ActiveUsersParams = {}) {
  const [payload, setPayload] = React.useState<ActiveUsersPayload | null>(null);
  const [status, setStatus] = React.useState<PresenceConnection>("reconnecting");
  const paramsRef = React.useRef(params);
  paramsRef.current = params;

  const load = React.useCallback(async () => {
    const response = await presenceApi.activeUsers({
      search: paramsRef.current.search || "",
      includeOffline: Boolean(paramsRef.current.includeOffline),
    });
    setPayload(response.data.data);
    return true;
  }, []);

  React.useEffect(() => {
    void load().catch(() => setStatus("reconnecting"));
  }, [load, params.includeOffline, params.search]);

  React.useEffect(() => {
    let stopped = false;
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let backoff = 3000;
    let stream: AbortController | undefined;
    let mode: "stream" | "poll" | "down" = "down";

    const stopPoll = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPoll = () => {
      if (pollTimer || stopped) return;
      pollTimer = window.setInterval(() => {
        void load().then(() => {
          if (mode !== "stream") setStatus("live");
        }).catch(() => setStatus("reconnecting"));
      }, 10_000);
    };
    const applyChunk = (part: string) => {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5).trim());
          if (event?.type !== "presence") continue;
          setPayload((current) => current ? {
            ...current,
            onlineCount: event.onlineCount,
            totalUsers: event.totalUsers,
            loggedOut: Math.max(0, Number(event.totalUsers) - Number(event.onlineCount)),
          } : current);
        } catch {
          // A partial frame is completed on the next chunk.
        }
      }
    };
    const connect = async () => {
      if (stopped) return;
      stream?.abort();
      const controller = new AbortController();
      stream = controller;
      mode = "down";
      setStatus("reconnecting");
      startPoll();
      try {
        const token = getSessionToken();
        const response = await fetch(streamUrl(), {
          headers: {
            Accept: "text/event-stream",
            Authorization: token ? `Bearer ${token}` : "",
            "x-session-auth": "required",
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("stream failed");
        mode = "stream";
        backoff = 3000;
        stopPoll();
        setStatus("live");
        await load();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          if (parts.length === 0) continue;
          parts.forEach(applyChunk);
          setStatus("live");
          void load().catch(() => undefined);
        }
        throw new Error("stream closed");
      } catch {
        if (stopped || controller.signal.aborted) return;
        mode = "poll";
        setStatus("reconnecting");
        startPoll();
        retryTimer = window.setTimeout(() => {
          void connect();
        }, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    };

    const refresh = () => {
      void load().then(() => {
        if (mode !== "down") setStatus("live");
      }).catch(() => setStatus("reconnecting"));
    };
    void connect();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      stopped = true;
      stream?.abort();
      stopPoll();
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  return { payload, status, reload: load };
}
