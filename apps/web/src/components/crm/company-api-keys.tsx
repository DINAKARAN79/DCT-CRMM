"use client";

import * as React from "react";
import { Copy, Download, Eye, EyeOff, KeyRound, Loader2, RotateCw, ShieldAlert } from "lucide-react";
import { companyApi } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CompanyApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  customHeaderName?: string | null;
  acceptOnlyCustomHeader?: boolean;
  status: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  needsRegenerate?: boolean;
  revealedToCompanyAdminAt?: string | null;
}

interface KeyPayload {
  company?: { id: string; name: string; companyCode: string };
  apiKey: CompanyApiKeyRecord | null;
  canRevealOnce?: boolean;
}

function formatWhen(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

export function CompanyApiKeys({
  tenantId,
  companyName,
  companyCode,
  onSecret,
  onDeleteScopeChange,
  onHeaderSettingsChange,
}: {
  tenantId: string;
  companyName?: string;
  companyCode?: string;
  onSecret?: (secret: string) => void;
  onDeleteScopeChange?: (enabled: boolean) => void;
  onHeaderSettingsChange?: (customHeaderName: string | null, acceptOnlyCustomHeader: boolean) => void;
}) {
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [record, setRecord] = React.useState<CompanyApiKeyRecord | null>(null);
  const [company, setCompany] = React.useState<KeyPayload["company"]>();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [revealedKey, setRevealedKey] = React.useState("");
  const [allowDelete, setAllowDelete] = React.useState(false);
  const [customHeaderName, setCustomHeaderName] = React.useState("");
  const [acceptOnlyCustomHeader, setAcceptOnlyCustomHeader] = React.useState(false);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState("");
  const [revealPurpose, setRevealPurpose] = React.useState<"show" | "copy">("show");
  const revealTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRevealKeyId = React.useRef<string | null>(null);
  const activeSuperAdmin = Boolean(isSuperAdmin);

  const setKeyVisible = React.useCallback((value: string) => {
    setRevealedKey(value);
    onSecret?.(value);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (value && activeSuperAdmin) {
      revealTimer.current = setTimeout(() => {
        setRevealedKey("");
        onSecret?.("");
      }, 30_000);
    }
  }, [activeSuperAdmin, onSecret]);

  const revealOnce = React.useCallback(async () => {
    try {
      const response = await companyApi.apiKey.setupRevealOnce(tenantId);
      if (!response.data?.success || !response.data.apiKey) {
        throw new Error(response.data?.error || "The one-time key could not be loaded.");
      }
      const data = response.data.data as CompanyApiKeyRecord;
      setRecord(data);
      setKeyVisible(response.data.apiKey);
    } catch (revealError: any) {
      const status = revealError?.response?.status;
      if (status !== 410) {
        setError(revealError?.response?.data?.error || revealError?.message || "The one-time key could not be loaded.");
      }
    }
  }, [setKeyVisible, tenantId]);

  const loadKey = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = activeSuperAdmin
        ? await companyApi.apiKey.get(tenantId)
        : await companyApi.apiKey.setupGet(tenantId);
      if (!response.data?.success) throw new Error(response.data?.error || "Failed to load the API key.");
      const payload = response.data.data as KeyPayload;
      setCompany(payload.company);
      setRecord(payload.apiKey);
      setCustomHeaderName(payload.apiKey?.customHeaderName || "");
      setAcceptOnlyCustomHeader(Boolean(payload.apiKey?.acceptOnlyCustomHeader));
      onHeaderSettingsChange?.(payload.apiKey?.customHeaderName || null, Boolean(payload.apiKey?.acceptOnlyCustomHeader));
      const deleteEnabled = Boolean(payload.apiKey?.scopes?.some((scope) => scope.endsWith(":delete")));
      setAllowDelete(deleteEnabled);
      onDeleteScopeChange?.(deleteEnabled);
      if (!activeSuperAdmin && payload.canRevealOnce && payload.apiKey?.id !== autoRevealKeyId.current) {
        autoRevealKeyId.current = payload.apiKey?.id || null;
        void revealOnce();
      }
    } catch (loadError: any) {
      setRecord(null);
      setError(loadError?.response?.data?.error || loadError?.message || "Failed to load the API key.");
    } finally {
      setLoading(false);
    }
  }, [activeSuperAdmin, onDeleteScopeChange, onHeaderSettingsChange, revealOnce, tenantId]);

  React.useEffect(() => {
    setKeyVisible("");
    autoRevealKeyId.current = null;
    void loadKey();
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      onSecret?.("");
    };
  }, [loadKey, onSecret, setKeyVisible, tenantId]);

  const downloadKey = (value: string) => {
    const blob = new Blob([`Save this key now. It will not be shown again.\n\n${value}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dct-api-key.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" });
    }
  };

  const openPasswordPrompt = (purpose: "show" | "copy") => {
    setRevealPurpose(purpose);
    setPassword("");
    setPasswordError("");
    setPasswordOpen(true);
  };

  const revealForSuperAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setPasswordError("");
    try {
      const response = await companyApi.apiKey.reveal(tenantId, password, revealPurpose);
      if (!response.data?.success || !response.data.apiKey) {
        throw new Error(response.data?.error || "Failed to reveal the API key.");
      }
      setKeyVisible(response.data.apiKey);
      if (revealPurpose === "copy") await copyToClipboard(response.data.apiKey);
      setPasswordOpen(false);
      setPassword("");
    } catch (revealError: any) {
      setPasswordError(revealError?.response?.data?.error || revealError?.message || "Failed to reveal the API key.");
    } finally {
      setSaving(false);
    }
  };

  const generateKey = async () => {
    if (!window.confirm("Generating a replacement immediately invalidates the existing key. Update every integration that uses it. Continue?")) return;
    setSaving(true);
    try {
      const response = await companyApi.apiKey.generate(tenantId);
      if (!response.data?.success) {
        throw new Error(response.data?.error || "Failed to generate an API key.");
      }
      setRecord(response.data.data as CompanyApiKeyRecord);
      setKeyVisible("");
      toast({ title: "API key generated", description: "The previous key was replaced. Use Show and re-enter your password to reveal it." });
    } catch (generateError: any) {
      toast({ title: "Could not generate the API key", description: generateError?.response?.data?.error || generateError?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = async () => {
    if (!window.confirm("Rotating the API key immediately invalidates the current key. Continue?")) return;
    setSaving(true);
    try {
      const response = activeSuperAdmin
        ? await companyApi.apiKey.rotate(tenantId)
        : await companyApi.apiKey.setupRotate(tenantId);
      if (!response.data?.success) throw new Error(response.data?.error || "Failed to rotate the API key.");
      const next = response.data.data as CompanyApiKeyRecord;
      setRecord(next);
      if (activeSuperAdmin) {
        setKeyVisible("");
      } else {
        autoRevealKeyId.current = next.id;
        const revealResponse = await companyApi.apiKey.setupRevealOnce(tenantId);
        if (!revealResponse.data?.success || !revealResponse.data.apiKey) {
          throw new Error(revealResponse.data?.error || "The key rotated, but its one-time reveal failed.");
        }
        setRecord(revealResponse.data.data as CompanyApiKeyRecord);
        setKeyVisible(revealResponse.data.apiKey);
      }
      toast({ title: "API key rotated", description: "The previous key no longer works." });
    } catch (rotateError: any) {
      toast({ title: "Could not rotate the API key", description: rotateError?.response?.data?.error || rotateError?.message || "Please try again.", variant: "destructive" });
      await loadKey();
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async () => {
    if (!window.confirm("Revoking this key immediately stops API requests using it. Continue?")) return;
    setSaving(true);
    try {
      const response = activeSuperAdmin
        ? await companyApi.apiKey.revoke(tenantId)
        : await companyApi.apiKey.setupRevoke(tenantId);
      if (!response.data?.success) throw new Error(response.data?.error || "Failed to revoke the API key.");
      setRecord(response.data.data as CompanyApiKeyRecord);
      setKeyVisible("");
      toast({ title: "API key revoked" });
    } catch (revokeError: any) {
      toast({ title: "Could not revoke the API key", description: revokeError?.response?.data?.error || revokeError?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateDeleteScope = async (enabled: boolean) => {
    setSaving(true);
    try {
      const response = activeSuperAdmin
        ? await companyApi.apiKey.updateScopes(tenantId, enabled)
        : await companyApi.apiKey.setupUpdateScopes(enabled, tenantId);
      if (!response.data?.success) throw new Error(response.data?.error || "Failed to update API scopes.");
      const updated = response.data.data as CompanyApiKeyRecord;
      setRecord(updated);
      const deleteEnabled = updated.scopes.some((scope) => scope.endsWith(":delete"));
      setAllowDelete(deleteEnabled);
      onDeleteScopeChange?.(deleteEnabled);
    } catch (scopeError: any) {
      toast({ title: "Could not update API scopes", description: scopeError?.response?.data?.error || scopeError?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateHeaderSettings = async () => {
    setSaving(true);
    try {
      const name = customHeaderName.trim() || null;
      const response = activeSuperAdmin
        ? await companyApi.apiKey.updateHeaderSettings(tenantId, name, acceptOnlyCustomHeader)
        : await companyApi.apiKey.setupUpdateHeaderSettings(name, acceptOnlyCustomHeader, tenantId);
      if (!response.data?.success) throw new Error(response.data?.error || "Failed to update API header settings.");
      const updated = response.data.data as CompanyApiKeyRecord;
      setRecord(updated);
      setCustomHeaderName(updated.customHeaderName || "");
      setAcceptOnlyCustomHeader(Boolean(updated.acceptOnlyCustomHeader));
      onHeaderSettingsChange?.(updated.customHeaderName || null, Boolean(updated.acceptOnlyCustomHeader));
      toast({ title: "API header settings saved" });
    } catch (headerError: any) {
      toast({ title: "Could not update API header settings", description: headerError?.response?.data?.error || headerError?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const status = record?.revokedAt || record?.status === "revoked" ? "Revoked" : record ? "Active" : "Not generated";
  const canManage = Boolean(record);

  return (
    <>
      <Card id="company-api-key-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">API key for this company</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {companyName || company?.name || "Company"}{companyCode || company?.companyCode ? ` · ${companyCode || company?.companyCode}` : ""}
              </p>
            </div>
            {record?.needsRegenerate && (
              <span className="rounded-full border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Needs regenerate
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Key prefix</p><code>{record?.keyPrefix || "—"}</code></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p>{status}</p></div>
                <div><p className="text-xs text-muted-foreground">Created</p><p>{formatWhen(record?.createdAt)}</p></div>
                <div><p className="text-xs text-muted-foreground">Last used</p><p>{formatWhen(record?.lastUsedAt)}</p></div>
              </div>

              {record?.needsRegenerate && activeSuperAdmin && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span className="flex-1">This legacy key cannot be recovered. Generate a replacement to store it securely.</span>
                  <Button type="button" size="sm" onClick={() => void generateKey()} disabled={saving}>
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Generate key
                  </Button>
                </div>
              )}

              {record && record.needsRegenerate && !activeSuperAdmin && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  This legacy key cannot be recovered. Ask a Super Admin to generate a replacement.
                </p>
              )}

              {record && !record.needsRegenerate && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
                  <code className="min-w-0 flex-1 break-all text-sm">
                    {revealedKey || (activeSuperAdmin ? "dct_live_••••••••" : record.keyPrefix)}
                  </code>
                  {activeSuperAdmin ? (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => revealedKey ? setKeyVisible("") : openPasswordPrompt("show")} disabled={saving}>
                        {revealedKey ? <EyeOff className="mr-1.5 h-3.5 w-3.5" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                        {revealedKey ? "Hide" : "Show"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => openPasswordPrompt("copy")} disabled={saving}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                      </Button>
                    </>
                  ) : revealedKey ? (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyToClipboard(revealedKey)}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => downloadKey(revealedKey)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Download as .txt
                      </Button>
                    </>
                  ) : record.revealedToCompanyAdminAt ? (
                    <span className="text-xs text-muted-foreground">This key has already been shown.</span>
                  ) : null}
                </div>
              )}
              {record && !record.needsRegenerate && (
                <div className="space-y-3 rounded-md border p-3">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Custom header name <span className="text-muted-foreground">(optional)</span></span>
                    <Input
                      value={customHeaderName}
                      onChange={(event) => setCustomHeaderName(event.target.value)}
                      placeholder="X-Company-Token"
                      pattern="[A-Za-z][A-Za-z0-9-]{1,60}"
                      aria-describedby="api-key-header-help"
                    />
                    <span id="api-key-header-help" className="text-xs text-muted-foreground">Use a header name such as X-Company-Token. Reserved header names are not allowed.</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={acceptOnlyCustomHeader} onChange={(event) => setAcceptOnlyCustomHeader(event.target.checked)} disabled={!customHeaderName.trim()} />
                    Accept only the custom header
                  </label>
                  {customHeaderName.trim() && <p className="break-all text-xs text-muted-foreground">Header: <code>{customHeaderName.trim()}: &lt;API key&gt;</code></p>}
                  <Button type="button" size="sm" variant="outline" onClick={() => void updateHeaderSettings()} disabled={saving || status !== "Active"}>
                    Save header settings
                  </Button>
                </div>
              )}

              {!record && activeSuperAdmin && (
                <Button type="button" size="sm" onClick={() => void generateKey()} disabled={saving}>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Generate key
                </Button>
              )}
              {!record && !activeSuperAdmin && (
                <p className="text-sm text-muted-foreground">No API key exists. Ask a Super Admin to generate one.</p>
              )}

              {record && revealedKey && !activeSuperAdmin && (
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Save this key now. It will not be shown again.</p>
              )}

              {canManage && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  {activeSuperAdmin && (
                    <label className="mr-auto flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allowDelete} onChange={(event) => void updateDeleteScope(event.target.checked)} disabled={saving || status !== "Active"} />
                      Allow delete API operations
                    </label>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => void rotateKey()} disabled={saving}>
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" /> {status === "Revoked" ? "Generate replacement" : "Rotate"}
                  </Button>
                  {status !== "Revoked" && (
                    <Button type="button" size="sm" variant="destructive" onClick={() => void revokeKey()} disabled={saving}>
                      Revoke
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <form onSubmit={(event) => void revealForSuperAdmin(event)}>
            <DialogHeader>
              <DialogTitle>Verify your password</DialogTitle>
              <DialogDescription>Enter your Super Admin password to {revealPurpose === "copy" ? "copy" : "reveal"} this key. This action is recorded in the audit log.</DialogDescription>
            </DialogHeader>
            <label className="mt-4 block space-y-1 text-sm">
              <span>Password</span>
              <input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3" />
            </label>
            {passwordError && <p role="alert" className="mt-2 text-sm text-destructive">{passwordError}</p>}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setPasswordOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || !password}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {revealPurpose === "copy" ? "Verify and copy" : "Verify and show"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
