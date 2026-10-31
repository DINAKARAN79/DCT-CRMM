"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ChevronDown, Copy, Download, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { CompanyApiCards } from "@/components/crm/company-api-cards";
import { companyApi } from "@/lib/api";
import { companyApiUrl } from "@/lib/company-api-url";
import { CompanyApiKeys } from "@/components/crm/company-api-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface CatalogField {
  name: string;
  path: string;
  type: string;
  requirement: "required" | "optional" | "conditional";
  condition?: string;
  enumValues?: string[];
  maxLength?: number;
  format?: string;
  description: string;
}

interface ApiParam {
  name: string;
  in: "path" | "query" | "header";
  type: string;
  required: boolean;
  description: string;
}

interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  scope: string | null;
  authNote: string;
  params: ApiParam[];
  headers: ApiParam[];
  updateMode?: "partial" | "replace";
  updateNote?: string;
  immutableAfterCreate?: string[];
  valueDifferences?: Array<{ field: string; create: string[]; update: string[] }>;
  body?: {
    fields: CatalogField[];
    requiredExample: Record<string, unknown>;
    fullExample: Record<string, unknown>;
  };
  successStatus: number;
  successExample: Record<string, unknown>;
  errors: Array<{ status: number; body: Record<string, unknown> }>;
  readOnlyResponseFields: string[];
  queryExample?: string | null;
}

interface ApiTopic {
  objectName: string;
  label: string;
  description: string;
  operations: ApiOperation[];
}

interface ApiCatalog {
  baseUrl: string;
  topics: ApiTopic[];
  schemaObjectNames: string[];
  openapi: Record<string, unknown>;
}

interface RegistryObject {
  name: string;
  label: string;
  pluralLabel?: string;
  description?: string | null;
}

interface PublicBaseUrl {
  baseUrl: string;
  source: "env" | "request" | "rejected";
  privateHost: boolean;
  warning: string | null;
}

interface ConnectivityResult {
  ok: boolean;
  status: number | null;
  reason: string;
}

interface FieldError {
  field: string;
  message: string;
}

const methodClass: Record<HttpMethod, string> = {
  GET: "bg-emerald-600 text-white",
  POST: "bg-blue-600 text-white",
  PUT: "bg-orange-500 text-white",
  DELETE: "bg-red-600 text-white",
};

function valueAt(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cursor, key) => {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    return (cursor as Record<string, unknown>)[key];
  }, record);
}

function localFieldErrors(fields: CatalogField[], body: unknown): FieldError[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [{ field: "", message: "Request body must be a JSON object." }];
  }
  const record = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const field of fields) {
    if (field.type === "object") continue;
    const value = valueAt(record, field.path);
    const empty = value === undefined || value === "";
    if (field.requirement === "required" && empty) {
      errors.push({ field: field.path, message: `${field.description} is required.` });
    }
    if (field.requirement === "conditional" && record.type === "Apartment" && (field.name === "block" || field.name === "floor") && empty) {
      errors.push({ field: field.path, message: field.condition || `${field.description} is required when type is Apartment.` });
    }
    if (field.enumValues?.length && value !== undefined && value !== "" && !field.enumValues.includes(String(value))) {
      errors.push({ field: field.path, message: `${field.description} must be one of ${field.enumValues.join(", ")}.` });
    }
  }
  return errors;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function exampleUrl(baseUrl: string, path: string, tenantId?: string, params?: ApiParam[]) {
  if (tenantId) return companyApiUrl({ baseUrl, path, tenantId, params }).url;
  return `${baseUrl}${path.replace(/:([A-Za-z0-9_]+)/g, "cmexample000000000000000001")}`;
}

function legacySnippet(language: "curl" | "fetch" | "python", method: HttpMethod, url: string, body: unknown | null, secret: string) {
  const key = secret || "<key>";
  const payload = body ? pretty(body) : "";
  if (language === "curl") {
    const lines = [`curl -X ${method} '${url}'`, `  -H 'Authorization: Bearer ${key}'`];
    if (body) lines.push("  -H 'Content-Type: application/json'", `  -d '${payload}'`);
    return lines.join(" \\\n");
  }
  if (language === "fetch") {
    return `await fetch('${url}', {
  method: '${method}',
  headers: {
    Authorization: 'Bearer ${key}',${body ? "\n    'Content-Type': 'application/json'," : ""}
  },${body ? `\n  body: JSON.stringify(${payload}),` : ""}
});`;
  }
  return `import requests

response = requests.${method.toLowerCase()}(
    '${url}',
    headers={'Authorization': 'Bearer ${key}'${body ? ", 'Content-Type': 'application/json'" : ""}},${body ? `\n    json=${payload},` : ""}
)`;
}

function snippet(
  language: "curl" | "fetch" | "python",
  method: HttpMethod,
  url: string,
  body: unknown | null,
  secret: string,
  headerSettings?: { customHeaderName: string | null; acceptOnlyCustomHeader: boolean },
) {
  if (!headerSettings) return legacySnippet(language, method, url, body, secret);
  const key = secret || "<key>";
  const headers = headerSettings.acceptOnlyCustomHeader && headerSettings.customHeaderName
    ? { [headerSettings.customHeaderName]: key }
    : {
        Authorization: `Bearer ${key}`,
        ...(headerSettings.customHeaderName ? { [headerSettings.customHeaderName]: key } : {}),
      };
  const payload = body ? pretty(body) : "";
  const requestHeaders = { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) };
  if (language === "curl") {
    const lines = [`curl -X ${method} '${url}'`, ...Object.entries(headers).map(([name, value]) => `  -H '${name}: ${value}'`)];
    if (body) lines.push("  -H 'Content-Type: application/json'", `  -d '${payload}'`);
    return lines.join(" \\\n");
  }
  if (language === "fetch") {
    return `await fetch('${url}', {
  method: '${method}',
  headers: ${JSON.stringify(requestHeaders, null, 2)},
${body ? `  body: JSON.stringify(${payload}),\n` : ""}});`;
  }
  return `import requests

response = requests.${method.toLowerCase()}(
    '${url}',
    headers=${JSON.stringify(requestHeaders)}${body ? `,\n    json=${payload}` : ""}
)`;
}

export function ApiOperationRow({
  operation,
  objectName,
  baseUrl,
  open,
  onToggle,
  secret,
  onSecretChange,
  detailsOnly = false,
  tenantId,
  headerSettings = { customHeaderName: null, acceptOnlyCustomHeader: false },
}: {
  operation: ApiOperation;
  objectName: string;
  baseUrl: string;
  open: boolean;
  onToggle?: () => void;
  secret: string;
  onSecretChange: (value: string) => void;
  detailsOnly?: boolean;
  tenantId?: string;
  headerSettings?: { customHeaderName: string | null; acceptOnlyCustomHeader: boolean };
}) {
  const { toast } = useToast();
  const [payloadMode, setPayloadMode] = React.useState<"required" | "full">("required");
  const [language, setLanguage] = React.useState<"curl" | "fetch" | "python">("curl");
  const [tryBody, setTryBody] = React.useState(operation.body ? pretty(operation.body.requiredExample) : "");
  const [sandbox, setSandbox] = React.useState(operation.method !== "GET");
  const [tryOpen, setTryOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldError[]>([]);
  const [result, setResult] = React.useState<{ status: number; ms: number; body: unknown } | null>(null);
  const activePayload = operation.body
    ? (payloadMode === "required" ? operation.body.requiredExample : operation.body.fullExample)
    : null;
  const url = exampleUrl(baseUrl, operation.path, tenantId, operation.params);
  const headerExample = [
    "Authorization: Bearer <API key>",
    "X-API-Key: <API key>",
    ...(operation.body ? ["Content-Type: application/json"] : []),
  ].join("\n");
  const configuredHeaderExample = headerSettings
    ? [
        ...(!headerSettings.acceptOnlyCustomHeader ? ["Authorization: Bearer <API key>", "X-API-Key: <API key>"] : []),
        ...(headerSettings.customHeaderName ? [`${headerSettings.customHeaderName}: <API key>`] : []),
        ...(operation.body ? ["Content-Type: application/json"] : []),
      ].join("\n")
    : headerExample;
  const errorFields = new Set(fieldErrors.map((error) => error.field));

  React.useEffect(() => {
    setTryBody(operation.body ? pretty(payloadMode === "required" ? operation.body.requiredExample : operation.body.fullExample) : "");
    setFieldErrors([]);
    setResult(null);
  }, [operation, payloadMode]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" });
    }
  };

  const runTry = async () => {
    setFieldErrors([]);
    setResult(null);
    if (!sandbox && !secret) {
      setFieldErrors([{ field: "", message: "Paste the API key secret to send a live request, or turn on Sandbox." }]);
      return;
    }
    let parsedBody: unknown = undefined;
    if (operation.body) {
      try {
        parsedBody = JSON.parse(tryBody);
      } catch {
        setFieldErrors([{ field: "", message: "Body is not valid JSON." }]);
        return;
      }
      const local = localFieldErrors(operation.body.fields, parsedBody);
      if (local.length) {
        setFieldErrors(local);
        return;
      }
      const validated = await companyApi.validateApiCatalog({
        objectName,
        operationId: operation.id,
        body: parsedBody,
      });
      const serverErrors = (validated.data?.data?.fieldErrors || []) as FieldError[];
      if (!validated.data?.data?.valid) {
        setFieldErrors(serverErrors.length ? serverErrors : [{ field: "", message: "The body does not match the schema." }]);
        return;
      }
    }
    setRunning(true);
    try {
      const response = await companyApi.tryApiCatalog({
        method: operation.method,
        path: operation.path.replace(/:([A-Za-z0-9_]+)/g, "cmexample000000000000000001"),
        body: parsedBody,
        headerName: headerSettings.customHeaderName || "X-API-Key",
        sandbox,
        objectName,
        operationId: operation.id,
      }, secret || undefined, headerSettings.customHeaderName);
      const data = response.data?.data || {};
      if (data.fieldErrors?.length && data.status === 400) {
        setFieldErrors(data.fieldErrors);
      }
      setResult({ status: data.status, ms: data.ms ?? 0, body: data.body });
    } catch (error: unknown) {
      const message = error && typeof error === "object" && "response" in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : "The request failed.";
      setResult({ status: 0, ms: 0, body: { success: false, error: message || "The request failed." } });
    } finally {
      setRunning(false);
    }
  };

  const showDetails = detailsOnly || open;
  return (
    <div className={detailsOnly ? "" : "rounded-md border bg-card"}>
      {!detailsOnly && (
        <button
          type="button"
          className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${methodClass[operation.method]}`}>{operation.method}</span>
          <span className="min-w-0 flex-1 text-sm font-medium">{operation.summary}</span>
          {operation.scope && <Badge variant="outline" className="font-normal">{operation.scope}</Badge>}
          <code className="max-w-full truncate text-xs text-muted-foreground">{operation.path}</code>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {showDetails && (
        <div className={detailsOnly ? "space-y-4 text-sm" : "space-y-4 border-t px-3 py-3 text-sm"}>
          <section>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${methodClass[operation.method]}`}>{operation.method}</span>
                <code className="min-w-0 overflow-x-auto whitespace-nowrap rounded bg-muted px-2 py-1 text-xs">{url}</code>
              </div>
              <div className="flex shrink-0 gap-1">
                {operation.method === "GET" ? (
                  <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${operation.summary}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md border">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => void copyText(url)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            </div>
          </section>
          <section className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{operation.description}</p>
            {operation.scope ? <Badge variant="outline" className="shrink-0 font-normal">{operation.scope}</Badge> : null}
          </section>
          <p className="text-xs text-muted-foreground">{operation.authNote}</p>
          {!!operation.params.length && (
            <section>
              <h4 className="mb-1 font-medium">Parameters</h4>
              <ParamTable params={operation.params} />
            </section>
          )}
          <section>
            <div className="mb-1 flex items-center justify-between gap-2">
              <h4 className="font-medium">Headers</h4>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyText(configuredHeaderExample)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{configuredHeaderExample}</pre>
          </section>
          {operation.body && (
            <section className="space-y-2">
              <h4 className="font-medium">Request body</h4>
              {operation.updateNote && <p className="text-muted-foreground">{operation.updateNote}</p>}
              {!!operation.immutableAfterCreate?.length && (
                <p className="text-muted-foreground">Cannot be changed after creation: {operation.immutableAfterCreate.join(", ")}.</p>
              )}
              {operation.valueDifferences?.map((difference) => (
                <p key={difference.field} className="text-muted-foreground">
                  {difference.field}: create allows {difference.create.join(", ")}; update also allows {difference.update.filter((value) => !difference.create.includes(value)).join(", ")}.
                </p>
              ))}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Field</th>
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Required</th>
                      <th className="px-2 py-1.5 font-medium">Allowed values</th>
                      <th className="px-2 py-1.5 font-medium">Format</th>
                      <th className="px-2 py-1.5 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operation.body.fields.filter((field) => field.type !== "object" || !operation.body?.fields.some((child) => child.path.startsWith(`${field.path}.`))).map((field) => (
                      <tr key={field.path} className={`border-t ${errorFields.has(field.path) ? "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100" : ""}`}>
                        <td className="px-2 py-1.5 font-mono">{field.path}</td>
                        <td className="px-2 py-1.5">{field.type}</td>
                        <td className="px-2 py-1.5">
                          {field.requirement === "required" && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Required</span>}
                          {field.requirement === "optional" && <span className="text-muted-foreground">Optional</span>}
                          {field.requirement === "conditional" && <span title={field.condition} className="cursor-help rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">Conditional</span>}
                        </td>
                        <td className="px-2 py-1.5">{field.enumValues?.join(", ") || "—"}</td>
                        <td className="px-2 py-1.5">{[field.format, field.maxLength ? `max ${field.maxLength}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="px-2 py-1.5">{field.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Tabs value={payloadMode} onValueChange={(value) => setPayloadMode(value as "required" | "full")}>
                <TabsList>
                  <TabsTrigger value="required">Required only</TabsTrigger>
                  <TabsTrigger value="full">Full example</TabsTrigger>
                </TabsList>
                <TabsContent value={payloadMode}>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyText(pretty(activePayload))}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setTryBody(pretty(activePayload))}>
                      Use in Try it
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{pretty(activePayload)}</pre>
                </TabsContent>
              </Tabs>
            </section>
          )}
          <section>
            <h4 className="mb-1 font-medium">Example request</h4>
            <Tabs value={language} onValueChange={(value) => setLanguage(value as "curl" | "fetch" | "python")}>
              <TabsList>
                <TabsTrigger value="curl">cURL</TabsTrigger>
                <TabsTrigger value="fetch">JavaScript fetch</TabsTrigger>
                <TabsTrigger value="python">Python requests</TabsTrigger>
              </TabsList>
              <TabsContent value={language}>
                <div className="mb-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyText(snippet(language, operation.method, url, activePayload, secret, headerSettings))}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{snippet(language, operation.method, url, activePayload, secret, headerSettings)}</pre>
              </TabsContent>
            </Tabs>
          </section>
          <section>
            <h4 className="mb-1 font-medium">Example responses</h4>
            {!!operation.readOnlyResponseFields.length && (
              <p className="mb-1 text-xs text-muted-foreground">Read-only in the response: {operation.readOnlyResponseFields.join(", ")}.</p>
            )}
            <Tabs defaultValue="success">
              <TabsList>
                <TabsTrigger value="success">Success ({operation.successStatus})</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
              </TabsList>
              <TabsContent value="success">
                <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{pretty(operation.successExample)}</pre>
              </TabsContent>
              <TabsContent value="errors">
                <div className="space-y-2">
                  {operation.errors.map((error) => (
                    <div key={error.status}>
                      <p className="mb-1 text-xs text-muted-foreground">{error.status}</p>
                      <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{pretty(error.body)}</pre>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium">Try it</h4>
              <Button type="button" size="sm" variant="outline" aria-expanded={tryOpen} onClick={() => setTryOpen((open) => !open)}>
                {tryOpen ? "Close tester" : "Open tester"}
              </Button>
            </div>
            {tryOpen ? <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1 text-xs text-muted-foreground">
                Secret
                <input value={secret} onChange={(event) => onSecretChange(event.target.value)} placeholder="dct_..." className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" />
              </label>
              <label className="flex items-center gap-2 pb-2 text-xs">
                <input type="checkbox" checked={sandbox} onChange={(event) => setSandbox(event.target.checked)} />
                Sandbox
              </label>
            </div>
            {operation.body && (
              <textarea
                value={tryBody}
                onChange={(event) => setTryBody(event.target.value)}
                rows={8}
                className={`w-full rounded-md border bg-background p-2 font-mono text-xs ${fieldErrors.length ? "border-red-600" : "border-input"}`}
              />
            )}
            {!!fieldErrors.length && (
              <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">
                {fieldErrors.map((error) => (
                  <li key={`${error.field}-${error.message}`}>{error.field ? `${error.field}: ` : ""}{error.message}</li>
                ))}
              </ul>
            )}
            <Button type="button" size="sm" onClick={() => void runTry()} disabled={running}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Send
            </Button>
            {result && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Status {result.status || "—"} · {result.ms} ms</p>
                {(result.status === 401 || result.status === 403 || result.status === 429) && (
                  <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                    {typeof result.body === "object" && result.body && "code" in result.body
                      ? `${String((result.body as { code?: string }).code || result.status)}: ${String((result.body as { message?: string }).message || "Request rejected")}`
                      : `Request rejected (${result.status})`}
                  </p>
                )}
                <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{pretty(result.body)}</pre>
              </div>
            )}
            </> : null}
          </section>
        </div>
      )}
    </div>
  );
}

function ParamTable({ params }: { params: ApiParam[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-2 py-1.5 font-medium">Name</th>
            <th className="px-2 py-1.5 font-medium">In</th>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">Required</th>
            <th className="px-2 py-1.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={`${param.in}-${param.name}`} className="border-t">
              <td className="px-2 py-1.5 font-mono">{param.name}</td>
              <td className="px-2 py-1.5">{param.in}</td>
              <td className="px-2 py-1.5">{param.type}</td>
              <td className="px-2 py-1.5">{param.required ? "Required" : "Optional"}</td>
              <td className="px-2 py-1.5">{param.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApiTopicPanel({
  topic,
  registry,
  baseUrl,
  secret,
  onSecretChange,
  headerSettings,
}: {
  topic: ApiTopic | null;
  registry: RegistryObject;
  baseUrl: string;
  secret: string;
  onSecretChange: (value: string) => void;
  headerSettings?: { customHeaderName: string | null; acceptOnlyCustomHeader: boolean };
}) {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedOp = searchParams.get("op") || "";
  const [fullIds, setFullIds] = React.useState<string[]>([]);
  const openOperation = topic?.operations.find((operation) => operation.id === requestedOp) || null;

  const setOp = (operationId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "api");
    params.set("object", registry.name.toLowerCase());
    if (operationId) params.set("op", operationId);
    else params.delete("op");
    router.replace(`/admin/companies?${params.toString()}`);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" });
    }
  };

  if (!topic) {
    return (
      <div className="rounded-md border border-dashed p-6">
        <h2 className="text-lg font-semibold">{registry.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{registry.description || `${registry.label} records for this company.`}</p>
        <p className="mt-4 text-sm text-muted-foreground">No validation schema is defined for {registry.label}, so example fields are not shown.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{topic.label}</h2>
        <p className="text-sm text-muted-foreground">{topic.description}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Required headers: <code>Authorization: Bearer &lt;API key&gt;</code> or <code>X-API-Key: &lt;API key&gt;</code>, <code>Content-Type: application/json</code>
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">API Link</th>
              <th className="px-3 py-2 font-medium">Example payload</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {topic.operations.map((operation) => {
              const href = baseUrl ? exampleUrl(baseUrl, operation.path) : "";
              const showFull = fullIds.includes(operation.id);
              const payload = operation.body
                ? pretty(showFull ? operation.body.fullExample : operation.body.requiredExample)
                : "";
              return (
                <tr key={operation.id} className="border-t align-top">
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${methodClass[operation.method]}`}>{operation.method}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <code className="break-all font-mono text-xs">{href || operation.path}</code>
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyText(href)} disabled={!href}>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {operation.method === "GET" && operation.queryExample && (
                      <div className="space-y-2">
                        <p>Query example: <code className="font-mono text-xs">{operation.queryExample}</code></p>
                        <Button type="button" size="sm" variant="outline" onClick={() => setOp(operation.id)}>View response</Button>
                      </div>
                    )}
                    {(operation.method === "DELETE" || (operation.method === "GET" && !operation.queryExample)) && (
                      <div className="space-y-2">
                        <p>none</p>
                        <Button type="button" size="sm" variant="outline" onClick={() => setOp(operation.id)}>View response</Button>
                      </div>
                    )}
                    {operation.body && (operation.method === "POST" || operation.method === "PUT") && (
                      <div className="space-y-2">
                        <pre className="max-w-md overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{payload}</pre>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => void copyText(payload)}>
                            <Copy className="h-3.5 w-3.5" /> Copy
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setFullIds((current) => current.includes(operation.id) ? current.filter((id) => id !== operation.id) : [...current, operation.id])}
                          >
                            {showFull ? "Required only" : "Full example"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => setOp(operation.id)}>Details</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {openOperation && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOp(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-background p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={openOperation.summary}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">{openOperation.summary}</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setOp(null)}>Close</Button>
            </div>
            <ApiOperationRow
              operation={openOperation}
              objectName={topic.objectName}
              baseUrl={baseUrl}
              open
              detailsOnly
              secret={secret}
              onSecretChange={onSecretChange}
              headerSettings={headerSettings}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function CompanyApiReference({ tenantId, companyName, companyCode }: { tenantId: string; companyName: string; companyCode: string }) {
  const [catalog, setCatalog] = React.useState<ApiCatalog | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [headerSettings, setHeaderSettings] = React.useState({ customHeaderName: null as string | null, acceptOnlyCustomHeader: false });
  const [allowDelete, setAllowDelete] = React.useState(false);
  const [base, setBase] = React.useState<PublicBaseUrl>({ baseUrl: "", source: "rejected", privateHost: false, warning: null });
  const [testingConnectivity, setTestingConnectivity] = React.useState(false);
  const [connectivity, setConnectivity] = React.useState<ConnectivityResult | null>(null);
  const handleDeleteScopeChange = React.useCallback((enabled: boolean) => setAllowDelete(enabled), []);
  const handleHeaderSettingsChange = React.useCallback((customHeaderName: string | null, acceptOnlyCustomHeader: boolean) => {
    setHeaderSettings({ customHeaderName, acceptOnlyCustomHeader });
  }, []);
  const isPublicPage = typeof window !== "undefined"
    && window.location.hostname.includes(".")
    && !window.location.hostname.endsWith(".local")
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(window.location.hostname);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogResponse, baseResponse] = await Promise.all([
        companyApi.apiCatalog(),
        companyApi.apiBaseUrl(),
      ]);
      if (!catalogResponse.data?.success) throw new Error(catalogResponse.data?.error || "Failed to load the API catalog");
      setCatalog(catalogResponse.data.data as ApiCatalog);
      if (baseResponse.data?.success && baseResponse.data.data) setBase(baseResponse.data.data as PublicBaseUrl);
      else throw new Error(baseResponse.data?.error || "Failed to resolve the public API base URL");
    } catch (loadError: unknown) {
      const message = loadError && typeof loadError === "object" && "response" in loadError
        ? (loadError as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
          || (loadError as { message?: string }).message
        : "Failed to load the API reference";
      setError(message || "Failed to load the API reference");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);
  const testConnectivity = async () => {
    setTestingConnectivity(true);
    setConnectivity(null);
    try {
      const response = await companyApi.testApiBaseUrl();
      if (!response.data?.success || !response.data.data) {
        throw new Error(response.data?.error || "Connectivity test failed");
      }
      setConnectivity(response.data.data as ConnectivityResult);
    } catch (testError: unknown) {
      const message = testError && typeof testError === "object" && "response" in testError
        ? (testError as { response?: { data?: { data?: ConnectivityResult; error?: string } }; message?: string }).response?.data?.data?.reason
          || (testError as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
          || (testError as { message?: string }).message
        : "Connectivity test failed";
      setConnectivity({ ok: false, status: null, reason: message || "Connectivity test failed" });
    } finally {
      setTestingConnectivity(false);
    }
  };
  const downloadSpec = () => {
    if (!catalog) return;
    const spec = structuredClone(catalog.openapi) as { servers?: Array<{ url?: string }> };
    if (spec.servers?.[0]) spec.servers[0].url = base.baseUrl;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${companyName.replace(/\s+/g, "-").toLowerCase()}-openapi.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{companyName}</h2>
          <p className="text-sm text-muted-foreground">External systems authenticate with an API key for this company.</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            API base URL: <code>{base.baseUrl || "Unavailable"}</code>
            {base.source === "env" ? " (from PUBLIC_API_BASE_URL)" : base.source === "request" ? " (auto-detected)" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={downloadSpec} disabled={!catalog || !base.baseUrl}>
            <Download className="h-4 w-4" /> Download OpenAPI JSON
          </Button>
          <Button type="button" onClick={() => document.getElementById("company-api-key-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <KeyRound className="h-4 w-4" /> API Keys
          </Button>
        </div>
      </div>
      {base.warning && (!base.privateHost || isPublicPage) && (
        <div className="space-y-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-200">
          <p>
            {base.privateHost
              ? "The API base URL is not set correctly for this server. Set PUBLIC_API_BASE_URL."
              : base.warning}
            {base.baseUrl ? <> Detected value: <code className="break-all">{base.baseUrl}</code></> : null}
          </p>
        </div>
      )}
      {base.baseUrl ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Button type="button" size="sm" variant="outline" onClick={() => void testConnectivity()} disabled={testingConnectivity}>
            {testingConnectivity ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Test connectivity
          </Button>
          {connectivity ? (
            <span role="status" className={connectivity.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
              {connectivity.ok ? "OK" : "Failed"}{connectivity.status ? ` (HTTP ${connectivity.status})` : ""}: {connectivity.reason}
            </span>
          ) : null}
        </div>
      ) : null}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      )}
      <CompanyApiKeys
        tenantId={tenantId}
        companyName={companyName}
        companyCode={companyCode}
        onSecret={setSecret}
        onDeleteScopeChange={handleDeleteScopeChange}
        onHeaderSettingsChange={handleHeaderSettingsChange}
      />
      {loading ? (
        <div className="space-y-3" aria-label="Loading API reference">
          {[0, 1, 2].map((item) => (
            <div key={item} className="animate-pulse rounded-md border p-4">
              <div className="h-5 w-40 rounded bg-muted" />
              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
              <div className="mt-4 flex gap-2">{[0, 1, 2, 3].map((chip) => <div key={chip} className="h-8 w-20 rounded bg-muted" />)}</div>
            </div>
          ))}
        </div>
      ) : catalog ? (
        catalog.topics.length ? (
          <CompanyApiCards<ApiOperation, ApiTopic>
            topics={catalog.topics}
            allowDelete={allowDelete}
            renderOperation={(topic, operation) => (
              <ApiOperationRow
                operation={operation}
                objectName={topic.objectName}
                baseUrl={base.baseUrl}
                open
                detailsOnly
                tenantId={tenantId}
                secret={secret}
                onSecretChange={setSecret}
                headerSettings={headerSettings}
              />
            )}
          />
        ) : <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No API objects are available for this company.</p>
      ) : !error ? <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">The API reference is unavailable.</p> : null}
    </div>
  );
}
