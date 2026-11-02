"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Phone } from "lucide-react";
import { telephonySettingsApi } from "@/lib/api";
import { openBizcallDialpad } from "@/lib/bizcall-dialpad";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEFAULT_CLICK_URL = "https://bizcall.cxteletech.com/api/integration/click2call";
const DEFAULT_DIALPAD_URL = "https://bizcall.cxteletech.com/embed/dialpad";

type TelephonySettings = {
  clickToCallUrl: string;
  authHeaderName: string;
  callerId?: string;
  allowTestUrl?: boolean;
  callIdFieldPath?: string;
  isActive: boolean;
  hasKey: boolean;
  keyLastFour: string;
  status: string;
  statusLabel: string;
  dialpadUrl: string;
  dialpadOrigin: string;
  dialpadMode: "DOCKED" | "NEW_TAB";
  callMethod: "SERVER_API" | "DIALPAD_MESSAGE";
  defaultDockState: "COLLAPSED" | "EXPANDED";
  theme: "CRM" | "LIGHT" | "DARK";
  productionOrigin: string;
  duplicateGuardSeconds: number;
  callsPerMinute: number;
  maskNumbers: boolean;
  blockDnc: boolean;
  dncNumbers: string;
};

type Probe = {
  reached?: boolean;
  httpStatus?: number | null;
  durationMs?: number;
  reason?: string;
};

type EnvironmentCheck = {
  tables: { telephonySettings: boolean; telephonyAgentPermissions: boolean };
  permissionProfiles: Array<{ name: string; granted: boolean }>;
  encryptionSecretPresent: boolean;
  keySaved: boolean;
  apiBaseUrl: string | null;
  apiBaseUrlSource: string;
  dialpadUrl: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null) return fallback;
  const value = error as { message?: string; response?: { data?: { message?: string; error?: string } } };
  return value.response?.data?.message || value.response?.data?.error || value.message || fallback;
}

export default function TelephonySettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, isLoading, isAuthenticated, isAdmin, isSuperAdmin } = useAuth();
  const tenantId = isSuperAdmin ? searchParams.get("tenantId") || "" : "";
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [status, setStatus] = React.useState("not_configured");
  const [statusLabel, setStatusLabel] = React.useState("Key missing");
  const [hasKey, setHasKey] = React.useState(false);
  const [keyLastFour, setKeyLastFour] = React.useState("");
  const [editingKey, setEditingKey] = React.useState(true);
  const [showKeyInput, setShowKeyInput] = React.useState(false);
  const [clickToCallUrl, setClickToCallUrl] = React.useState(DEFAULT_CLICK_URL);
  const [authHeaderName, setAuthHeaderName] = React.useState("X-API-KEY");
  const [authToken, setAuthToken] = React.useState("");
  const [callerId, setCallerId] = React.useState("");
  const [isActiveSetting, setIsActiveSetting] = React.useState(false);
  const [allowTestUrl, setAllowTestUrl] = React.useState(false);
  const [callIdFieldPath, setCallIdFieldPath] = React.useState("");
  const [probe, setProbe] = React.useState<Probe | null>(null);
  const [environment, setEnvironment] = React.useState<EnvironmentCheck | null>(null);
  const [securePage, setSecurePage] = React.useState<boolean | null>(null);
  const [grantingProfiles, setGrantingProfiles] = React.useState(false);
  const [dialpadUrl, setDialpadUrl] = React.useState(DEFAULT_DIALPAD_URL);
  const [dialpadMode, setDialpadMode] = React.useState<"DOCKED" | "NEW_TAB">("DOCKED");
  const [callMethod, setCallMethod] = React.useState<"SERVER_API" | "DIALPAD_MESSAGE">("SERVER_API");
  const [defaultDockState, setDefaultDockState] = React.useState<"COLLAPSED" | "EXPANDED">("COLLAPSED");
  const [theme, setTheme] = React.useState<"CRM" | "LIGHT" | "DARK">("CRM");
  const [productionOrigin, setProductionOrigin] = React.useState("");
  const [duplicateGuardSeconds, setDuplicateGuardSeconds] = React.useState(10);
  const [callsPerMinute, setCallsPerMinute] = React.useState(10);
  const [maskNumbers, setMaskNumbers] = React.useState(false);
  const [blockDnc, setBlockDnc] = React.useState(false);
  const [dncNumbers, setDncNumbers] = React.useState("");
  const [agents, setAgents] = React.useState<Array<{ userId: string; userName: string; profileId: string | null; profileName: string; canUseTelephony: boolean; registeredInBizcall: string; lastCallAt: string | null }>>([]);
  const [checkingEmbedding, setCheckingEmbedding] = React.useState(false);
  const [embeddingResult, setEmbeddingResult] = React.useState<{
    verdict: string;
    httpStatus: number;
    headers: { xFrameOptions: string | null; contentSecurityPolicy: string | null; frameAncestors: string | null };
  } | null>(null);
  const [testCalling, setTestCalling] = React.useState(false);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const currentSettings = {
    clickToCallUrl, authHeaderName, authToken, callerId, isActiveSetting, allowTestUrl,
    callIdFieldPath, dialpadUrl, dialpadMode, callMethod, defaultDockState, theme,
    productionOrigin, duplicateGuardSeconds, callsPerMinute, maskNumbers, blockDnc, dncNumbers,
  };
  const isDirty = baseline !== null && baseline !== JSON.stringify(currentSettings);

  const applySettings = (data: TelephonySettings) => {
    setClickToCallUrl(data.clickToCallUrl || DEFAULT_CLICK_URL);
    setAuthHeaderName(data.authHeaderName || "X-API-KEY");
    setCallerId(data.callerId || "");
    setIsActiveSetting(Boolean(data.isActive));
    setAllowTestUrl(Boolean(data.allowTestUrl));
    setCallIdFieldPath(data.callIdFieldPath || "");
    setHasKey(Boolean(data.hasKey));
    setKeyLastFour(data.keyLastFour || "");
    setEditingKey(!data.hasKey);
    setShowKeyInput(false);
    setAuthToken("");
    setStatus(data.status || "not_configured");
    setStatusLabel(data.statusLabel || "Key missing");
    setDialpadUrl(data.dialpadUrl || DEFAULT_DIALPAD_URL);
    setDialpadMode(data.dialpadMode || "DOCKED");
    setCallMethod(data.callMethod || "SERVER_API");
    setDefaultDockState(data.defaultDockState || "COLLAPSED");
    setTheme(data.theme || "CRM");
    setProductionOrigin(data.productionOrigin || "");
    setDuplicateGuardSeconds(data.duplicateGuardSeconds || 10);
    setCallsPerMinute(data.callsPerMinute || 10);
    setMaskNumbers(Boolean(data.maskNumbers));
    setBlockDnc(Boolean(data.blockDnc));
    setDncNumbers(data.dncNumbers || "");
    setBaseline(JSON.stringify({
      clickToCallUrl: data.clickToCallUrl || DEFAULT_CLICK_URL,
      authHeaderName: data.authHeaderName || "X-API-KEY",
      authToken: "",
      callerId: data.callerId || "",
      isActiveSetting: Boolean(data.isActive),
      allowTestUrl: Boolean(data.allowTestUrl),
      callIdFieldPath: data.callIdFieldPath || "",
      dialpadUrl: data.dialpadUrl || DEFAULT_DIALPAD_URL,
      dialpadMode: data.dialpadMode || "DOCKED",
      callMethod: data.callMethod || "SERVER_API",
      defaultDockState: data.defaultDockState || "COLLAPSED",
      theme: data.theme || "CRM",
      productionOrigin: data.productionOrigin || "",
      duplicateGuardSeconds: data.duplicateGuardSeconds || 10,
      callsPerMinute: data.callsPerMinute || 10,
      maskNumbers: Boolean(data.maskNumbers),
      blockDnc: Boolean(data.blockDnc),
      dncNumbers: data.dncNumbers || "",
    }));
  };

  React.useEffect(() => {
    if (!isLoading && (!isAuthenticated || (!isAdmin && !isSuperAdmin))) {
      router.replace(isAuthenticated ? "/home" : "/login?redirect=/setup/integrations/telephony");
    }
  }, [isAuthenticated, isAdmin, isSuperAdmin, isLoading, router]);

  React.useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isSuperAdmin) || (isSuperAdmin && !tenantId)) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    telephonySettingsApi.get(tenantId || undefined)
      .then((response) => {
        if (active && response.data.data) applySettings(response.data.data as TelephonySettings);
      })
      .catch((error: unknown) => {
        if (active) {
          toast({
            title: "Unable to load telephony",
            description: errorMessage(error, "Failed to load telephony settings."),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, isAuthenticated, isSuperAdmin, tenantId, toast]);

  React.useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isSuperAdmin) || (isSuperAdmin && !tenantId)) return;
    telephonySettingsApi.agents(tenantId || undefined)
      .then((response) => setAgents(Array.isArray(response.data.data) ? response.data.data as typeof agents : []))
      .catch((error: unknown) => toast({ title: "Unable to load agents", description: errorMessage(error, "Failed to load telephony agents."), variant: "destructive" }));
  }, [isAdmin, isAuthenticated, isSuperAdmin, tenantId, toast]);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      const localHost = process.env.NODE_ENV !== "production" && (
        hostname === "localhost" || hostname === "::1" ||
        (hostname.split(".").length === 4 && Number(hostname.split(".")[0]) === 127)
      );
      setSecurePage(window.location.protocol === "https:" || localHost);
    }
    if (!isAuthenticated || (!isAdmin && !isSuperAdmin) || (isSuperAdmin && !tenantId)) return;
    let active = true;
    telephonySettingsApi.environmentCheck(tenantId || undefined)
      .then((response) => {
        if (active && response.data.data) setEnvironment(response.data.data as EnvironmentCheck);
      })
      .catch((error: unknown) => {
        if (active) toast({ title: "Environment check unavailable", description: errorMessage(error, "Unable to inspect telephony deployment settings."), variant: "destructive" });
      });
    if (typeof window !== "undefined") {
      telephonySettingsApi.checkEmbedding(window.location.origin, tenantId || undefined)
        .then((response) => {
          if (active && response.data.data) setEmbeddingResult(response.data.data as NonNullable<typeof embeddingResult>);
        })
        .catch(() => {
          if (active) setEmbeddingResult({
            verdict: "Unable to verify whether Bizcall allows this CRM origin.",
            httpStatus: 0,
            headers: { xFrameOptions: null, contentSecurityPolicy: null, frameAncestors: null },
          });
        });
    }
    return () => { active = false; };
  }, [isAdmin, isAuthenticated, isSuperAdmin, tenantId, toast]);

  React.useEffect(() => {
    if (!isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!window.confirm("You have unsaved telephony changes. Leave this page without saving?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [isDirty]);

  const save = async () => {
    const trimmedKey = authToken.trim();
    if (isActiveSetting && !hasKey && !trimmedKey) {
      toast({
        title: "Bizcall API key required",
        description: "Enter the Bizcall API key before turning telephony on.",
        variant: "destructive",
      });
      return;
    }
    if (isActiveSetting && !clickToCallUrl.trim()) {
      toast({ title: "Click-to-call URL required", description: "Enter the Bizcall URL before turning telephony on.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await telephonySettingsApi.update({
        clickToCallUrl: clickToCallUrl.trim(),
        authHeaderName: authHeaderName.trim(),
        callerId: callerId.trim(),
        isActive: isActiveSetting,
        allowTestUrl,
        callIdFieldPath,
        dialpadUrl: dialpadUrl.trim(),
        dialpadMode,
        callMethod,
        defaultDockState,
        theme,
        productionOrigin: productionOrigin.trim(),
        duplicateGuardSeconds,
        callsPerMinute,
        maskNumbers,
        blockDnc,
        dncNumbers,
        ...(trimmedKey ? { authToken: trimmedKey } : {}),
      }, tenantId || undefined);
      if (response.data.data) applySettings(response.data.data as TelephonySettings);
      toast({ title: "Telephony saved", description: "Click-to-call will use these settings." });
      try {
        const environmentResponse = await telephonySettingsApi.environmentCheck(tenantId || undefined);
        if (environmentResponse.data.data) setEnvironment(environmentResponse.data.data as EnvironmentCheck);
      } catch (error: unknown) {
        toast({ title: "Environment check unavailable", description: errorMessage(error, "Unable to refresh deployment diagnostics."), variant: "destructive" });
      }
    } catch (error: unknown) {
      toast({
        title: "Unable to save telephony",
        description: errorMessage(error, "Failed to save telephony settings."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setProbe(null);
    try {
      const response = await telephonySettingsApi.testConnection(tenantId || undefined);
      setProbe(response.data.data as Probe || { reason: response.data.message });
    } catch (error: unknown) {
      setProbe({ reached: false, reason: errorMessage(error, "The connection test could not run.") });
    } finally {
      setTesting(false);
    }
  };

  const saveAgentAccess = async (userIds: string[], enabled: boolean) => {
    try {
      await telephonySettingsApi.updateAgents({ userIds, enabled }, tenantId || undefined);
      const response = await telephonySettingsApi.agents(tenantId || undefined);
      setAgents(Array.isArray(response.data.data) ? response.data.data as typeof agents : []);
    } catch (error: unknown) {
      toast({ title: "Unable to update agent access", description: errorMessage(error, "Failed to update telephony access."), variant: "destructive" });
    }
  };

  const grantDefaultProfiles = async () => {
    setGrantingProfiles(true);
    try {
      await telephonySettingsApi.grantDefaultProfiles(tenantId || undefined);
      toast({ title: "Telephony access granted", description: "Admin, Sales and Presales profiles can now place calls." });
      try {
        const [agentsResponse, environmentResponse] = await Promise.all([
          telephonySettingsApi.agents(tenantId || undefined),
          telephonySettingsApi.environmentCheck(tenantId || undefined),
        ]);
        setAgents(Array.isArray(agentsResponse.data.data) ? agentsResponse.data.data as typeof agents : []);
        if (environmentResponse.data.data) setEnvironment(environmentResponse.data.data as EnvironmentCheck);
      } catch (error: unknown) {
        toast({ title: "Unable to refresh telephony status", description: errorMessage(error, "Access was granted but status could not be refreshed."), variant: "destructive" });
      }
    } catch (error: unknown) {
      toast({ title: "Unable to grant telephony access", description: errorMessage(error, "Failed to update profile permissions."), variant: "destructive" });
    } finally {
      setGrantingProfiles(false);
    }
  };

  const testCall = async () => {
    if (!window.confirm("Place a real test call to the phone number on your admin profile?")) return;
    setTestCalling(true);
    try {
      const response = await telephonySettingsApi.testCall(tenantId || undefined);
      toast({ title: response.data.ok ? "Test call sent" : "Test call failed", description: response.data.message || "Check the telephony settings.", variant: response.data.ok ? undefined : "destructive" });
    } catch (error: unknown) {
      toast({ title: "Test call failed", description: errorMessage(error, "The test call could not be completed."), variant: "destructive" });
    } finally {
      setTestCalling(false);
    }
  };

  const checkEmbedding = async () => {
    setCheckingEmbedding(true);
    setEmbeddingResult(null);
    try {
      const response = await telephonySettingsApi.checkEmbedding(window.location.origin, tenantId || undefined);
      setEmbeddingResult(response.data.data as NonNullable<typeof embeddingResult>);
    } catch (error: unknown) {
      toast({
        title: "Unable to check iframe embedding",
        description: errorMessage(error, "Bizcall embedding headers could not be fetched."),
        variant: "destructive",
      });
    } finally {
      setCheckingEmbedding(false);
    }
  };

  const openDialpadNow = () => {
    try {
      openBizcallDialpad(dialpadUrl, user?.id || "", theme, (url, target) => window.open(url, target));
    } catch {
      toast({ title: "Invalid dialpad URL", description: "Enter a valid HTTPS dialpad URL first.", variant: "destructive" });
    }
  };

  const copyOrigins = async () => {
    const origins = [window.location.origin, productionOrigin.trim()].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(origins);
      toast({ title: "Origins copied", description: "Share these CRM origins with Bizcall for whitelisting." });
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the origins manually.", variant: "destructive" });
    }
  };

  if (isLoading || !isAuthenticated || (!isAdmin && !isSuperAdmin)) return null;

  const badgeClass = status === "active"
    ? "bg-emerald-50 text-emerald-700"
    : status === "inactive"
      ? "bg-amber-50 text-amber-800"
      : "bg-slate-100 text-slate-600";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={tenantId ? `/setup?tenantId=${encodeURIComponent(tenantId)}` : "/setup"} className="text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Setup / Integrations</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Telephony</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>{statusLabel}</span>
          </div>
          <p className="text-sm text-muted-foreground">Configure Bizcall click-to-call for this company.</p>
        </div>
      </div>

      {isSuperAdmin && !tenantId ? (
        <p className="text-sm text-muted-foreground">Open this page from a company in Setup Home to edit that company&apos;s telephony settings.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading telephony settings...</p>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-sky-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Status</h2>
                <p className="text-sm text-muted-foreground">Telephony is controlled for the whole company.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>{statusLabel}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActiveSetting}
                disabled={!hasKey && !authToken.trim()}
                onChange={(event) => setIsActiveSetting(event.target.checked)}
              />
              Active
            </label>
            {!hasKey && !authToken.trim() ? <p className="text-xs text-amber-700">Add a Bizcall API key before enabling telephony.</p> : null}
          </section>

          {isAdmin || isSuperAdmin ? (
            <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
              <h2 className="font-medium">Environment check</h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Database tables present</dt><dd>telephony_settings: {environment?.tables.telephonySettings ? "Yes" : "No"} · telephony_agent_permissions: {environment?.tables.telephonyAgentPermissions ? "Yes" : "No"}</dd></div>
                <div>
                  <dt className="text-muted-foreground">TELEPHONY_CALL permission</dt>
                  <dd>{environment ? environment.permissionProfiles.filter((profile) => profile.granted).map((profile) => profile.name).join(", ") || "No default profile has it" : "Checking…"}</dd>
                </div>
                <div><dt className="text-muted-foreground">Encryption secret present</dt><dd>{environment ? (environment.encryptionSecretPresent ? "Yes" : "No") : "Checking…"} (value is never shown)</dd></div>
                <div><dt className="text-muted-foreground">Bizcall key saved</dt><dd>{environment ? (environment.keySaved ? "Yes" : "No") : "Checking…"}</dd></div>
                <div><dt className="text-muted-foreground">Page served over HTTPS</dt><dd>{securePage === null ? "Checking…" : securePage ? "Yes" : "No — microphones are blocked on plain HTTP."}</dd></div>
                <div className="min-w-0"><dt className="text-muted-foreground">API base URL detected</dt><dd className="break-all">{environment?.apiBaseUrl || "Unavailable"}{environment?.apiBaseUrlSource ? ` (${environment.apiBaseUrlSource})` : ""}</dd></div>
                <div><dt className="text-muted-foreground">Bizcall allows this iframe origin</dt><dd>{embeddingResult?.verdict || "Checking…"}<span className="mt-1 block break-all text-xs text-muted-foreground">{typeof window !== "undefined" ? window.location.origin : ""}</span></dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">For production microphone access, use an AWS Application Load Balancer or CloudFront with an ACM certificate and redirect HTTP to HTTPS.</p>
            </section>
          ) : null}
          {securePage === false ? (
            <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
              Calls need HTTPS. Microphone access is blocked on plain HTTP.
            </p>
          ) : null}

          <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Agents</h2>
                <p className="text-sm text-muted-foreground">Users with TELEPHONY_CALL permission can place calls when company telephony is active.</p>
              </div>
              {isAdmin || isSuperAdmin ? <Button type="button" variant="outline" size="sm" disabled={grantingProfiles} onClick={() => void grantDefaultProfiles()}>{grantingProfiles ? "Granting…" : "Grant telephony to these profiles"}</Button> : null}
            </div>
            {agents.length ? (
              <ul className="divide-y">
                {agents.map((agent) => (
                  <li key={agent.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{agent.userName} <span className="text-muted-foreground">({agent.profileName})</span></span>
                    <span className="flex items-center gap-2">
                      <span>{agent.canUseTelephony ? "Permission granted" : "No permission"}</span>
                      {isAdmin || isSuperAdmin ? <Button type="button" variant="ghost" size="sm" onClick={() => void saveAgentAccess([agent.userId], !agent.canUseTelephony)}>{agent.canUseTelephony ? "Revoke" : "Grant"}</Button> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No active agents found.</p>}
          </section>

          <form
            className="space-y-5 rounded-xl border border-sky-100 bg-white p-5 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex items-center gap-2 text-[#075d91]">
              <Phone className="h-4 w-4" />
              <p className="text-sm font-medium">Bizcall connection</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="telephony-click-url">Click-to-call URL</Label>
              <Input id="telephony-click-url" value={clickToCallUrl} onChange={(event) => setClickToCallUrl(event.target.value)} placeholder={DEFAULT_CLICK_URL} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telephony-header-name">Auth header name</Label>
              <Input id="telephony-header-name" value={authHeaderName} onChange={(event) => setAuthHeaderName(event.target.value)} placeholder="X-API-KEY" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telephony-token">Bizcall API key</Label>
              {hasKey && !editingKey ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm" aria-label="Saved Bizcall API key">
                    Key saved: bc_live_••••••••{keyLastFour}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    setEditingKey(true);
                    setAuthToken("");
                    setShowKeyInput(false);
                  }}>
                    Change key
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Input
                      id="telephony-token"
                      type={showKeyInput ? "text" : "password"}
                      autoComplete="new-password"
                      value={authToken}
                      onChange={(event) => setAuthToken(event.target.value)}
                      placeholder="Paste the Bizcall API key"
                      className="pr-11"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      aria-label={showKeyInput ? "Hide API key" : "Show API key"}
                      onClick={() => setShowKeyInput((current) => !current)}
                    >
                      {showKeyInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Create it in Bizcall &gt; Integrations Hub. It starts with bc_live_.</p>
                  {authToken.trim() && !authToken.trim().startsWith("bc_live_") ? (
                    <p className="text-xs text-amber-700">This key does not start with bc_live_. Check that you copied the correct Bizcall API key.</p>
                  ) : null}
                </>
              )}
              {hasKey && editingKey ? (
                <p className="text-xs text-muted-foreground">Leave this empty to keep the currently saved key.</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="telephony-caller-id">Caller ID (optional)</Label>
              <Input id="telephony-caller-id" value={callerId} onChange={(event) => setCallerId(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={testing || !hasKey} onClick={() => void testConnection()}>
                {testing ? "Testing..." : "Test connection"}
              </Button>
              <Button type="button" variant="outline" disabled={testCalling || !hasKey || !isActiveSetting} onClick={() => void testCall()}>
                {testCalling ? "Calling..." : "Place test call to my number"}
              </Button>
            </div>
            {probe ? (
              <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm">
                <p className="font-medium">{probe.reached ? "Reached" : "Not reached"}</p>
                <p>{probe.reason}</p>
                <p className="text-muted-foreground">HTTP status: {probe.httpStatus ?? "none"} · {probe.durationMs ?? 0} ms</p>
              </div>
            ) : null}

            <section className="space-y-4 border-t pt-5">
              <div>
                <h2 className="font-medium">Dialpad</h2>
                <p className="text-sm text-muted-foreground">Configure how agents access the Bizcall dialpad.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="telephony-dialpad-url">Dialpad URL</Label>
                <Input id="telephony-dialpad-url" value={dialpadUrl} onChange={(event) => setDialpadUrl(event.target.value)} placeholder={DEFAULT_DIALPAD_URL} />
                <p className="text-xs text-muted-foreground">For security, the dialpad must use https://bizcall.cxteletech.com, which is the only external frame origin allowed by the CRM.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Dialpad mode</span>
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={dialpadMode} onChange={(event) => {
                    const mode = event.target.value as "DOCKED" | "NEW_TAB";
                    setDialpadMode(mode);
                    if (mode === "NEW_TAB" && callMethod === "DIALPAD_MESSAGE") setCallMethod("SERVER_API");
                  }}>
                    <option value="DOCKED">Docked panel inside the CRM (recommended)</option>
                    <option value="NEW_TAB">Open in a new tab</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Call method per click</span>
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={callMethod} onChange={(event) => setCallMethod(event.target.value as "SERVER_API" | "DIALPAD_MESSAGE")}>
                    <option value="SERVER_API">Server API (Bizcall rings agent, then customer)</option>
                    <option value="DIALPAD_MESSAGE" disabled={dialpadMode === "NEW_TAB"}>Dialpad message (DIAL via postMessage)</option>
                  </select>
                  <span className="block text-xs text-muted-foreground">Only the selected method runs for a click. Never both.</span>
                  {dialpadMode === "NEW_TAB" ? <span className="block text-xs text-muted-foreground">Dialpad message mode is available only in the docked panel.</span> : null}
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Default dock state</span>
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={defaultDockState} onChange={(event) => setDefaultDockState(event.target.value as "COLLAPSED" | "EXPANDED")}>
                    <option value="COLLAPSED">Collapsed</option>
                    <option value="EXPANDED">Expanded</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Theme</span>
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={theme} onChange={(event) => setTheme(event.target.value as "CRM" | "LIGHT" | "DARK")}>
                    <option value="CRM">Follow CRM</option>
                    <option value="LIGHT">Light</option>
                    <option value="DARK">Dark</option>
                  </select>
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="production-origin">Production CRM origin (optional)</Label>
                <Input id="production-origin" value={productionOrigin} onChange={(event) => setProductionOrigin(event.target.value)} placeholder="https://crm.example.com" />
              </div>
              <div className="rounded-md border bg-slate-50 p-3 text-sm">
                <p>Allowed dialpad origin: <code>{(() => { try { return new URL(dialpadUrl).origin; } catch { return "Enter a valid dialpad URL"; } })()}</code></p>
                <p className="mt-1 text-xs text-muted-foreground">Bizcall must whitelist these CRM origins:</p>
                <p className="mt-1 break-all text-xs">{typeof window !== "undefined" ? window.location.origin : ""}</p>
                {productionOrigin ? <p className="break-all text-xs">{productionOrigin}</p> : null}
                <div className="mt-2 flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyOrigins()}>Copy origins</Button>
                  <Button type="button" variant="outline" size="sm" disabled={checkingEmbedding} onClick={checkEmbedding}>{checkingEmbedding ? "Checking…" : "Check iframe"}</Button>
                  <Button type="button" variant="outline" size="sm" onClick={openDialpadNow}>Open dialpad now</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  If the dialpad shows &quot;refused to connect&quot;, ask Bizcall to allow {typeof window !== "undefined" ? window.location.origin : "this CRM origin"} in frame-ancestors, or use &quot;Open in a new tab&quot;.
                </p>
                <p className="text-xs text-muted-foreground">Keep only one Bizcall dialpad tab open per agent, with ?userId=... in the URL.</p>
                {embeddingResult ? (
                  <div className="mt-2 space-y-1 rounded-md border bg-background p-3 text-xs">
                    <p className="font-semibold">{embeddingResult.verdict}</p>
                    <p>HTTP status: {embeddingResult.httpStatus}</p>
                    <p className="break-all">X-Frame-Options: {embeddingResult.headers.xFrameOptions || "(not returned)"}</p>
                    <p className="break-all">Content-Security-Policy: {embeddingResult.headers.contentSecurityPolicy || "(not returned)"}</p>
                    <p className="break-all">frame-ancestors: {embeddingResult.headers.frameAncestors || "(not returned)"}</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-4 border-t pt-5">
              <div>
                <h2 className="font-medium">Call behaviour</h2>
                <p className="text-sm text-muted-foreground">Configure duplicate protection, rate limits, display masking and Do-Not-Call rules.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Duplicate click guard (seconds)</span>
                  <Input type="number" min={1} max={120} value={duplicateGuardSeconds} onChange={(event) => setDuplicateGuardSeconds(Number(event.target.value))} />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Calls per minute per user</span>
                  <Input type="number" min={1} max={60} value={callsPerMinute} onChange={(event) => setCallsPerMinute(Number(event.target.value))} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={maskNumbers} onChange={(event) => setMaskNumbers(event.target.checked)} /> Mask customer numbers for agents</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blockDnc} onChange={(event) => setBlockDnc(event.target.checked)} /> Block Do-Not-Call numbers</label>
              <div className="space-y-2">
                <Label htmlFor="dnc-numbers">Do-Not-Call numbers (E.164, one per line)</Label>
                <textarea id="dnc-numbers" className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={dncNumbers} onChange={(event) => setDncNumbers(event.target.value)} placeholder={"+14155552671"} />
              </div>
              <p className="text-xs text-muted-foreground">Lead rule: New leads move to Incoming when a call is initiated. Later statuses are never downgraded.</p>
            </section>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="submit" disabled={saving || !isDirty}>{saving ? "Saving..." : "Save settings"}</Button>
            </div>
          </form>

        </>
      )}
    </div>
  );
}
