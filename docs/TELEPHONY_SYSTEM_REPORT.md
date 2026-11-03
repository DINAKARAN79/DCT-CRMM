# Telephony system: current implementation

## Scope and evidence

This report describes the source and Prisma schema in the current working tree, not a live AWS database or a verified production deployment. No database was queried or changed for this report, and no AWS endpoint was contacted. The report's statuses mean:

- **BUILT AND WORKING** — an implemented code path exists and relevant focused tests passed where listed.
- **BUILT BUT UNTESTED** — an implementation is present, but this report did not establish runtime/provider behavior.
- **PARTIAL** — some of the requested behavior exists, with material limitations.
- **NOT BUILT** — no implementation was found in the reviewed code paths.
- **UNKNOWN (needs Bizcall confirmation)** — the CRM cannot establish provider-side behavior from its source.

Evidence references name the repository-relative file and relevant function/component. Prisma model references point to `packages/db/prisma/schema.prisma`.

## A. Architecture overview

**Status: PARTIAL** — both outbound methods and a separate inbound integration-key receiver exist. Actual Bizcall behavior is not verified by CRM code.

```text
Lead page / Leads list
  -> requestLeadCall() -> BizcallDialpadDock handler
     -> SERVER_API: POST /api/telephony/click-to-call
        -> authenticate + permission + lead access + tenant settings
        -> Bizcall click2call REST endpoint
        -> CallDetail + audit + telephony_request_logs
     -> DIALPAD_MESSAGE: POST /api/telephony/dialpad-call-started
        -> authenticated API validates/normalizes lead number and creates CallDetail
        -> postMessage DIAL to Bizcall iframe
        -> iframe events -> POST /api/telephony/dialpad-event
        -> CallDetail + audit + lead process note (disposition)

Bizcall / calling provider
  -> POST /api/integrations/telephony/:integrationKey/lead
     -> integration key hash -> tenant resolution -> inbound parsing/idempotency
     -> match or create lead -> inbound CallDetail + receipt
     -> NEW lead status may change to INCOMING + audit/process note
```

The Next.js dashboard mounts `BizcallDialpadDock` in the dashboard layout; it uses same-origin `/api/proxy/...` requests to reach the Express API. Express mounts the click-to-call/dialpad routes at `/api/telephony`, settings at `/api/setup/telephony`, and the inbound receiver at `/api/integrations/telephony`. Super-admin integration-management routes mount at `/api/super-admin/companies/:tenantId/telephony`. Evidence: `apps/web/src/app/(dashboard)/layout.tsx` (`DashboardShell`), `apps/web/src/lib/api.ts` (`API_BASE_URL`, `clickToCallApi`), `apps/web/src/app/api/proxy/[...path]/route.ts` (`proxyRequest`), `apps/api/src/index.ts` (router mounts).

**Component inventory**

| Component | Status | What the code does | Evidence |
|---|---|---|---|
| Lead detail, lead list, follow-up detail | BUILT AND WORKING | Lead detail and list provide call affordances; follow-up detail displays phone values as text. | `apps/web/src/app/(dashboard)/leads/[id]/page.tsx` (`placeCall`, phone rows); `apps/web/src/app/(dashboard)/leads/page.tsx` (`callLead`); `apps/web/src/components/crm/lead-list.tsx` (Phone cell and actions menu); `apps/web/src/app/(dashboard)/follow-ups/[id]/page.tsx` (Lead Information). |
| Dialpad dock and bridge | BUILT BUT UNTESTED | Mounts the external iframe, sends commands, listens to validated `postMessage` events, and posts events to the API. | `apps/web/src/components/crm/bizcall-dialpad-dock.tsx` (`BizcallDialpadDock`); `apps/web/src/lib/bizcall-dialpad.ts` (`sendDialerCommand`, lock helpers). |
| Next.js API proxy | BUILT AND WORKING | Forwards methods, cookies, selected headers, query string, and request body to `BACKEND_URL`; response is returned to the browser. | `apps/web/src/app/api/proxy/[...path]/route.ts` (`proxyRequest`, method handlers). |
| Outbound REST service | BUILT AND WORKING | Validates and sends REST click-to-call, logs attempts, and records successful/failed provider responses. | `apps/api/src/services/clickToCall.ts` (`placeClickToCall`, `sendClickToCall`, `recordClickAttempt`). |
| Inbound receiver | BUILT BUT UNTESTED against Bizcall | Accepts a CRM integration-key callback, matches/creates a lead, records an inbound call, and stores an idempotency receipt. | `apps/api/src/routes/telephonyWebhook.ts` (POST handler); `apps/api/src/services/telephonyInbound.ts` (`ingestTelephonyCall`); `apps/api/src/services/telephonyIntegration.ts` (`storeFor`). |
| Background telephony job | NOT BUILT | No telephony-specific scheduled job or worker was found in the reviewed source. | Telephony route/service implementations above; no telephony job is registered in `apps/api/src/index.ts`. |
| Database | BUILT | Prisma models cover CallDetail, settings, per-agent overrides, integrations, receipts, and outbound request logs. No separate dialpad session table is modeled. | `packages/db/prisma/schema.prisma` (`CallDetail`, `TelephonySetting`, `TelephonyAgentPermission`, `TelephonyIntegration`, `TelephonyCallReceipt`, `TelephonyRequestLog`). |
| External Bizcall REST and iframe | UNKNOWN (needs Bizcall confirmation) | Source configures a default click-to-call URL and dialpad URL, but does not establish that the real provider accepts the CRM payload/events or permits production framing. | `apps/api/src/services/telephonyUrl.ts` (`DEFAULT_CLICK_TO_CALL_URL`, `DEFAULT_DIALPAD_URL`); `apps/web/next.config.js` (`headers`). |

## B. Click-to-call: click through to provider

### UI affordances

**Status: PARTIAL** — lead detail and list initiate calls; follow-up detail does not.

| Surface | Status | Handler / condition |
|---|---|---|
| Lead detail header green call button | BUILT AND WORKING | `placeCall("phone")`; rendered when `hasEffectivePermission("TELEPHONY_CALL") && telephonyActive`. |
| Lead detail Phone, Mobile, Secondary Phone fields | BUILT AND WORKING | `LayoutDrivenForm` renders a button for nonempty Lead phone/mobile/secondaryPhone only when `onCallPhone` is provided; this page passes that callback when calls are enabled. Otherwise it renders the value as text. |
| Leads list Phone column | BUILT AND WORKING | Button calls `onCall(row.original)` if permission, active telephony, phone, and callback exist. Otherwise it shows text and, when there is a number, `TelephonyStatusHint`. |
| Leads list “…” menu | BUILT AND WORKING | “Call” item uses the same `onCall` handler, only for a lead with a primary phone and when enabled. |
| Follow-up detail Phone/Mobile | NOT BUILT | `DetailRow` renders the values; no click handler or call button is supplied. |
| Other follow-up pages / task phone field | NOT BUILT | No call affordance was found in the reviewed follow-up detail/task form paths. |

Evidence: `apps/web/src/app/(dashboard)/leads/[id]/page.tsx` (`canCall`, `placeCall`, header button); `apps/web/src/components/admin/layout-driven-form.tsx` (Lead phone field renderer); `apps/web/src/app/(dashboard)/leads/page.tsx` (`canCall`, `callLead`); `apps/web/src/components/crm/lead-list.tsx` (Phone cell, actions menu); `apps/web/src/app/(dashboard)/follow-ups/[id]/page.tsx` (Phone/Mobile rows).

### Link/plain-text and dock eligibility

The lead/list call affordance is controlled by the browser's effective permission and `telephonyActive`. The dock obtains settings and permission through `/api/telephony/client-config`; active requires an active setting, a saved credential that can be decrypted, and `TELEPHONY_CALL`. `telephonyActive` is not itself a test of frame loading or a test of Bizcall agent registration. `placeRequest` can still reject due to impersonation, another active call, dock lock, or iframe not being online. Evidence: `apps/web/src/lib/telephony-client.ts` (`useTelephonyActive`); `apps/api/src/routes/telephonyClickToCall.ts` (`GET /client-config`); `apps/web/src/components/crm/bizcall-dialpad-dock.tsx` (`placeRequest`).

| Failure reason | Code / user-facing explanation |
|---|---|
| Permission absent | `NO_PERMISSION`: “You do not have permission to place calls. Ask an admin.” |
| Permission definition missing | `PERMISSION_UNAVAILABLE`: administrators are told `public."Permission"."name" = TELEPHONY_CALL` is missing and pointed to `TELEPHONY_AWS_FIX.md`; non-admins are told to ask an admin. |
| No settings row | `NOT_CONFIGURED`: telephony is not set up for the company. |
| Settings inactive | `DISABLED`: telephony is switched off. |
| Credential absent | `KEY_MISSING`: API key is missing. |
| Credential cannot decrypt | `KEY_UNREADABLE`: admin hint names `API_KEY_ENCRYPTION_SECRET`; non-admin hint says telephony is not set up. |
| Impersonating | Dock sets telephony inactive and presents “Calls are disabled while viewing as another user”; handler also blocks with `IMPERSONATION_DISABLED`. |
| Docked iframe blocked/not online | `DIALPAD_BLOCKED`; message says Bizcall did not allow embedding and suggests a new tab or provider allowlisting. |
| Dock owned by another tab | `DIALPAD_IN_ANOTHER_TAB`. |
| Message mode with NEW_TAB | `DIALPAD_MESSAGE_UNAVAILABLE`; message mode requires Docked. |
| Plain HTTP | Dock warns that calls need HTTPS/microphone access. This is a dock transport/microphone check, **not** part of the list/detail button condition itself. |

Tooltip/hint evidence: `apps/web/src/components/crm/telephony-status-hint.tsx` (`reasonMessage`); state evidence: `apps/web/src/components/crm/bizcall-dialpad-dock.tsx` (`setTelephonyStatus`, `placeRequest`, transport check). The dock refreshes client config periodically; on lead pages it polls every five seconds when permission is absent/unavailable, otherwise every 30 seconds. When server config reports permission but the client auth state does not, it calls the auth `refresh()` function.

### Browser request and API validation

**REST path: BUILT AND WORKING.** The browser posts JSON with exactly `{ leadId, phoneField }` to `/api/proxy/api/telephony/click-to-call` (default `phoneField` is `"phone"`). The Next proxy forwards it to the backend. The browser does not send its own phone number, tenant ID, or user ID for this request. Evidence: `apps/web/src/lib/click-to-call.ts` (`placeLeadCall`); `apps/web/src/lib/api.ts` (`clickToCallApi.place`); `apps/api/src/routes/telephonyClickToCall.ts` (`requestSchema`, POST `/click-to-call`).

The server validates request shape, then `placeClickToCall` checks effective permission, resolves lead by both lead ID and session tenant, checks `canAccessLead`, selects the requested lead phone field, normalizes to E.164, loads tenant settings, checks active/key/method, checks the DNC list, validates URL, decrypts the key, checks duplicate guard and rate limit, and sends. Phone normalization occurs in `normalizeLeadPhone` from `leadDuplicateDetection.ts`; secondary phone uses its secondary country code while Phone/Mobile use the lead country code. Evidence: `apps/api/src/routes/telephonyClickToCall.ts` (`requestSchema`); `apps/api/src/services/clickToCall.ts` (`placeClickToCall`, `phoneValue`); `apps/api/src/services/leadDuplicateDetection.ts` (`normalizeLeadPhone`).

| Guard | Implementation |
|---|---|
| Tenant and lead visibility | Tenant comes from authenticated `req.tenantId`; lead query includes that tenant; `canAccessLead` is checked. |
| Duplicate click | Per API process in-memory map keyed by `userId:leadId`; settings default 10 seconds, range 1–120. |
| Rate limit | Per API process in-memory timestamps keyed by user; default 10 calls/minute, range 1–60. |
| DNC | Compares normalized E.164 number with configured DNC numbers when `blockDnc` is enabled. |
| Number masking | Request log/audit number is masked. `CallDetail.callTo` stores the normalized full number. UI masking is a separate setting. |

Evidence: `apps/api/src/services/clickToCall.ts` (`repeatBlocked`, `takeRateSlot`, `maskPhone`, `recordClickAttempt`); `apps/api/src/services/telephonySettings.ts` (`telephonySettingsSchema`).

### Two methods; one path per click

`callMethod === "SERVER_API"` calls `placeLeadCall` and sends the REST request; it does not send a `DIAL` message. `callMethod === "DIALPAD_MESSAGE"` calls `/dialpad-call-started`, obtains the server-normalized E.164 number and CallDetail ID, then sends a single `DIAL` command; it does not invoke the REST click-to-call path. `NEW_TAB + DIALPAD_MESSAGE` is rejected. Evidence: `apps/web/src/components/crm/bizcall-dialpad-dock.tsx` (`placeRequest`); `apps/api/src/routes/telephonyClickToCall.ts` (POST `/dialpad-call-started`).

The dialpad method has its own in-memory duplicate/rate guards and a database duplicate lookup before creating a CallDetail. If no `BIZCALL_AGENT_REGISTERED` event arrives, the DIAL command can wait up to five seconds, after which the browser reports that the dialpad is connecting. A CallDetail is created before the DIAL command is sent; a failed/queued command does not guarantee a provider call. Evidence: `reserveDialpadCall` and `/dialpad-call-started` in `apps/api/src/routes/telephonyClickToCall.ts`; `queueDialUntilRegistered` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`.

## C. Outbound Bizcall REST request

**Status: BUILT BUT UNTESTED against the live provider.**

| Item | Current implementation |
|---|---|
| URL | Tenant setting `clickToCallUrl`; default `https://bizcall.cxteletech.com/api/integration/click2call`. |
| Method | `POST`, JSON body. |
| Headers | `Content-Type: application/json`; configured auth header name (default `X-API-KEY`) with the decrypted key. The source does not send `Accept`. |
| Body | `{"userId":"<authenticated CRM user id>","customerNumber":"+91XXXXXXXXXX","recordId":"<lead id>","leadName":"<name>"}` and optionally `"callerId":"<configured caller id>"`. |
| Field constants | `CLICK_TO_CALL_PAYLOAD_KEYS` in `apps/api/src/services/clickToCall.ts`: `userId`, `customerNumber`, `recordId`, `leadName`, `callerId`. |
| Excluded fields | REST payload contains no `tenantId`, `agentId`, `taskId`, or API key. `userId` is the CRM authenticated user ID; whether Bizcall maps it to an agent is unknown. |
| Timeout/retry | 10 seconds per attempt. One retry for network, DNS, or TLS transport failures; no retry on timeout or HTTP response. |
| Redirects | `redirect: 'manual'`; redirects are not followed. |
| Success | Only HTTP 200 with JSON object `{ "success": true }` is considered initiated. |
| Provider call ID | Read from configured `callIdFieldPath`, default `originateUuid`; supports dotted object paths and string/number values. Stored in nullable `CallDetail.providerCallId`. |
| Provider response | Sanitized recursively before storage in `CallDetail.providerResponse`: sensitive-key names removed; configured key and exact customer number redacted; strings clipped, with limits on depth, keys, and arrays. |

Evidence: `buildClickToCallPayload`, `CLICK_TO_CALL_PAYLOAD_KEYS`, `buildOutboundHeaders`, `postOnce`, `sendClickToCall`, `readCallIdPath`, `sanitizeProviderBody`, `recordClickAttempt` in `apps/api/src/services/clickToCall.ts`.

| Bizcall response | CRM result / user message | CallDetail |
|---|---|---|
| 200 + `success: true` | `INITIATED`, HTTP 200; “Calling … your phone will ring shortly.” UI toast title is “Request sent to Bizcall”. | `Initiated`; provider ID and sanitized body saved when available. |
| 200 without `success: true` | `PROVIDER_REJECTED`, CRM HTTP 502; response detail may be included after sanitization. | `Failed`; provider response saved. |
| 401 | `PROVIDER_REJECTED`, HTTP 502; admin gets sanitized provider detail/default key guidance, non-admin gets “Could not place the call.” | `Failed`. |
| 403 | Same CRM mapping as 401. | `Failed`. |
| Other 4xx / 5xx | `PROVIDER_REJECTED`, HTTP 502; message includes status and sanitized provider message/error when present. | `Failed`. |
| 3xx | `PROVIDER_REJECTED`, HTTP 502; says redirect was not followed. | `Failed`. |
| Timeout | `PROVIDER_TIMEOUT`, HTTP 504; “Bizcall did not answer in time.” | No row is saved because no response was reached. |
| DNS / TLS / network failure after retry | `PROVIDER_UNREACHABLE`, HTTP 502; message distinguishes DNS/TLS where recognized. | No row is saved because no response was reached. |

For any HTTP response, the call attempt is recorded with `Initiated` or `Failed`; transport failures do not create the CallDetail. The browser toast labels a reached-provider result “Request sent to Bizcall” even if the provider rejected it, because the service sets `step: sent_to_provider` for any received HTTP response. Evidence: `placeClickToCall` response mapping, `recordClickAttempt`, `clickToCallToast` in `apps/api/src/services/clickToCall.ts` and `apps/web/src/lib/click-to-call.ts`.

## D. Dialpad dock and `postMessage` API

**Status: BUILT BUT UNTESTED against Bizcall.**

### Frame, URL and lock

The dashboard mounts the dock on normal dashboard pages; it is hidden for most Setup pages, and is shown on Telephony Setup. The iframe URL is the configured dialpad URL plus `userId=<authenticated user id>` and `theme=light|dark` (CRM theme maps to light). It does not add tenantId to the URL. The new-tab target name includes encoded tenant and user IDs. The iframe is allowed `microphone; autoplay`. The app adds `frame-src 'self' <DIALPAD_URL origin>` and `microphone=(self "<DIALPAD_URL origin>")`; the web build rejects an HTTP `DIALPAD_URL` in production. Evidence: `BizcallDialpadDock`, `dialpadUrlFor`, `openDialpadTab` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`; `buildBizcallDialpadUrl`, `openBizcallDialpad` in `apps/web/src/lib/bizcall-dialpad.ts`; `headers` in `apps/web/next.config.js`.

Docked mode uses browser localStorage key `bizcall:<tenantId>:<userId>:lock` and a matching BroadcastChannel namespace ending in `:channel`. Heartbeat is every 2 seconds; a lock is stale after 5 seconds. This is a per-browser-origin/tab coordination mechanism, not a server-side, cross-device agent lock. The X button asks for confirmation if a call is active, sends `BIZCALL_HANGUP`, and closes after an ended event; if no call is active it clears local call state and closes immediately. Evidence: `buildBizcallNamespaceKey`, `claimDialpadLock` in `apps/web/src/lib/bizcall-dialpad.ts`; lock constants and `closeDock` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`.

### Commands sent to Bizcall

Commands are posted to the exact dialpad origin, never `"*"`. The bridge verifies the frame is loaded and validates the origin; incoming messages must match both expected origin and iframe `contentWindow`. `INIT_USER` is sent on iframe load. `DIAL` waits up to five seconds for `BIZCALL_AGENT_REGISTERED` if the iframe is not online. `BIZCALL_HANGUP` is sent on End/close or dock teardown when a call is in progress. Evidence: `sendDialerCommand` and `isTrustedBizcallMessage` in `apps/web/src/lib/bizcall-dialpad.ts`; `sendCommand`, `queueDialUntilRegistered`, iframe `onLoad`, `closeDock` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`.

| Command | Shape | When |
|---|---|---|
| `INIT_USER` | `{ type: "INIT_USER", userId: "<authenticated CRM user id>" }` | Iframe load. |
| `DIAL` | `{ type: "DIAL", number: "+91XXXXXXXXXX", recordId: "<lead id>", leadName: "<name>", taskId?: "<task id>", tenantId?: "<authenticated tenant id>" }` | After `/dialpad-call-started` validates the lead and returns normalized number. `taskId` is optional; the lead UI paths reviewed do not supply one. `tenantId` is included when `sendTenantIdInDial` is true (default true). |
| `BIZCALL_HANGUP` | `{ type: "BIZCALL_HANGUP" }` | User ends call, closes dock during call, or component teardown. |

The `DIAL` tenantId is browser-sourced from the authenticated dashboard tenant context, not from the lead request body. It is not authoritative to the API; server-side route tenant comes from `authenticate`. `userId` in `INIT_USER` also comes from the authenticated dashboard context. Lead ID and normalized phone in `DIAL` come from the API response. Evidence: `placeRequest` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`; `/dialpad-call-started` in `apps/api/src/routes/telephonyClickToCall.ts`; `authenticate` in `apps/api/src/middleware/auth.ts`.

### Events received

Event names are `BIZCALL_AGENT_REGISTERED`, `BIZCALL_CALL_STARTING`, `BIZCALL_CALL_CONNECTED`, `BIZCALL_CALL_ENDED`, `BIZCALL_DISPOSITION_SUBMITTED`. The browser source/origin check is enforced before event processing. Data is normalized in the dock; phone is E.164-checked then masked in local monitor entries; notes are redacted in monitor fields. API event calls contain the event and relevant leadId, callUuid, number, duration, durationFormatted, disposition, notes, or (for registration) name/extension. The browser does not send tenantId or userId in the event API body. The backend derives both from the authenticated request, even though its strict schema accepts optional `tenantId`/`userId` fields. Evidence: dock `onMessage` in `apps/web/src/components/crm/bizcall-dialpad-dock.tsx`; `dialpadEventSchema` and POST `/dialpad-event` in `apps/api/src/routes/telephonyClickToCall.ts`.

| Event | CRM-side update |
|---|---|
| `BIZCALL_AGENT_REGISTERED` | Sets browser state ONLINE and audits received name/extension. No CallDetail is changed. |
| `BIZCALL_CALL_STARTING` | Finds a call by provider/call UUID or recent active dialpad call; may create a manual outbound CallDetail when no lead context exists. Moves `Initiated` to `Calling`. For an associated lead, applies the New-to-Incoming rule. |
| `BIZCALL_CALL_CONNECTED` | Sets status `Connected`, sets `answeredAt` once, and stores providerCallId if supplied. |
| `BIZCALL_CALL_ENDED` | Sets status `Ended`, `endAt`, and supplied duration, unless the matched call is already terminal. |
| `BIZCALL_DISPOSITION_SUBMITTED` | Updates disposition and/or notes when changed; for a lead, appends a lead process note. It does not change call status. |

The API event endpoint is authenticated and permission-checked, rate-limited to 60 events/minute per tenant/user in process memory, tenant-scopes leads/calls, and checks lead access. Event matching first uses call UUID, then a recent (five-minute) active call for the same tenant/user and lead/number. Terminal call statuses are not overwritten by later start/connect/end events; disposition can still update. This is not a provider signature check at the API boundary. Evidence: `allowDialpadEvent`, POST `/dialpad-event` in `apps/api/src/routes/telephonyClickToCall.ts`.

Whether Bizcall emits these events for inbound calls, what exact payload values it emits, and whether its agent registration maps to CRM user IDs: **UNKNOWN (needs Bizcall confirmation)**.

## E. Call Details and telephony data model

**Status: BUILT AND WORKING** — model and write paths exist. Status column is a string, not a database enum; there is no centralized finite status constraint.

### `CallDetail`

Prisma model `CallDetail` in `packages/db/prisma/schema.prisma`; optional columns are nullable. It has a Tenant relation, optional Lead relation, required creator User relation, optional modifier and owner User relations, and optional `case` relation to Lead. There is no profile relation. `callId` is unique; `@@unique([tenantId, name])`; indexes are `(tenantId, leadId, startAt)`, `(tenantId, createdById, startAt)`, `(tenantId, createdById, providerCallId)`, plus `caseId`, `createdById`, `lastModifiedById`, and `ownerId`.

| Column | Type / nullability |
|---|---|
| `id` | String, required, CUID default |
| `name` | VarChar(255), required |
| `tenantId` | String, required |
| `callFrom` | VarChar(255), nullable |
| `callId` | VarChar(255), required, unique, CUID default |
| `callTo` | VarChar(50), nullable |
| `callType` | VarChar(50), required |
| `caseId` | String, nullable |
| `createdById` | String, required |
| `duration` | Int, required, default 0 |
| `endAt` | DateTime, required |
| `executiveContactNo` | VarChar(50), nullable |
| `landingNumber` | VarChar(255), nullable |
| `lastModifiedById` | String, nullable |
| `leadId` | String, nullable |
| `ownerId` | String, nullable |
| `parentId` | VarChar(100), nullable |
| `parentUrl` | VarChar(255), nullable |
| `recordingFile` | VarChar(255), nullable |
| `startAt` | DateTime, required |
| `answeredAt` | DateTime, nullable |
| `status` | VarChar(50), required, default `"COMPLETED"` |
| `notes` | String, nullable |
| `disposition` | VarChar(120), nullable |
| `source` | VarChar(40), nullable |
| `providerCallId` | VarChar(255), nullable |
| `providerResponse` | JSON, nullable |
| `createdAt` | DateTime, required, default now |
| `updatedAt` | DateTime, required, Prisma updatedAt |

### Writes and status behavior

| Writer | Columns written / status |
|---|---|
| Outbound REST click | `tenantId`, `leadId`, generated `name`, `callType=OUTBOUND`, full normalized `callTo`, `status=Initiated` or `Failed`, `notes` on failure, `startAt`, `endAt`, `createdById`, `ownerId`, `providerCallId` (success only), `providerResponse` (when present), `source=server_api`, `duration=0`. |
| Dialpad lead call start | `tenantId`, `leadId`, generated `name`, `callType=OUTBOUND`, normalized `callTo`, `status=Initiated`, timestamps, `duration=0`, creator/owner, `source=dialpad`; then events can set providerCallId/status/answeredAt/endAt/duration/disposition/notes/lastModifiedById. |
| Dialpad manual call | Lead is null; call starts as `Calling` on `BIZCALL_CALL_STARTING` or `Initiated` from manual-number endpoint; event may fill providerCallId and update status/duration/disposition/notes. |
| Integration webhook inbound call | `callType=INBOUND`, `callFrom`, `callTo`, `landingNumber`, `duration`, timestamps, mapped inbound status, `recordingFile`, notes, `leadId`, creator, tenant. The provider call ID is put into unique `callId` as `<tenantId>:<providerCallId>`; the inbound writer does not set `providerCallId`. |

Actual written statuses include `Initiated`, `Calling`, `Connected`, `Ended`, `Failed`, `COMPLETED`, `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `CANCELLED`; other existing call-detail features may use additional strings. The inbound mapper maps unknown/other statuses to `COMPLETED`. Dialpad event status updates allow `Initiated -> Calling`, nonterminal -> `Connected`, nonterminal -> `Ended`; a terminal set (`Ended`, `Completed`, `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `CANCELLED`) is not changed by start/connect/end. Duplicate events usually re-find and update the same record; there is no separate event receipt/idempotency key for iframe events. Evidence: `recordClickAttempt` in `clickToCall.ts`; `/dialpad-call-started` and `/dialpad-event` in `telephonyClickToCall.ts`; `storeFor` in `telephonyIntegration.ts`; `callStatus` in `telephonyInbound.ts`.

### Other telephony tables

| Model/table | Fields / behavior |
|---|---|
| `TelephonySetting` / `telephony_settings` | One row per tenant (`tenantId` unique, no Tenant relation in the model). Stores outbound/dialpad configuration, encrypted API credential and extra headers, key last four, activation, method/mode/theme, origin, duplicate/rate settings, number mask and DNC settings. |
| `TelephonyAgentPermission` / `telephony_agent_permissions` | `id`, `tenantId`, `userId`, `canUse`, `updatedById`, `updatedAt`; unique `(tenantId,userId)`. False override denies telephony even when profile/direct permission grants it. |
| `TelephonyIntegration` / `telephony_integrations` | `id`, `tenantId`, `name`, `keyPrefix`, `keyHash`, `ipAllowlist[]`, `rateLimitPerMinute` (default 120), `lastUsedAt`, `revokedAt`, `createdById`, `createdAt`; indexed by tenant and tenant/revoked. Secret is hashed, not stored in raw form. |
| `TelephonyCallReceipt` / `telephony_call_receipts` | `id`, `tenantId`, `integrationId`, `providerCallId`, `leadId`, nullable `callDetailId`, `createdAt`; unique `(tenantId,providerCallId)`. No cleanup job was found. |
| `TelephonyRequestLog` / `telephony_request_logs` | `id`, `tenantId`, `userId`, nullable `leadId`, nullable `maskedNumber`, `step`, `code`, nullable `httpStatus`, nullable `durationMs`, nullable `reason`, `createdAt`. Querying logs deletes rows older than 30 days and returns the newest 50. |

Evidence: each corresponding Prisma model in `packages/db/prisma/schema.prisma`; `listTelephonyRequestLogs` in `apps/api/src/services/telephonySettings.ts`; outbound log writer in `apps/api/src/services/clickToCall.ts`.

## F. Inbound calls

**Status: PARTIAL** — a shared-key inbound call receiver exists. Provider compatibility and inbound iframe events remain unconfirmed.

| Inbound feature | Status | Evidence / behavior |
|---|---|---|
| CRM webhook receiver | BUILT BUT UNTESTED with Bizcall | `POST /api/integrations/telephony/:integrationKey/lead`, mounted in `apps/api/src/index.ts`; handler in `apps/api/src/routes/telephonyWebhook.ts`. |
| Integration-key authentication | BUILT AND WORKING | `tel_` key is hashed and looked up; rejects missing/revoked keys. Tenant comes from the integration record. |
| HMAC/signature validation | NOT BUILT | No signature or timestamp verification in the route. |
| IP allowlist and rate limit | BUILT | Optional IP allowlist; per-integration in-process API-key rate limiter; configured default 120/minute. |
| Lead matching | BUILT | Looks for any phone/mobile/secondaryPhone match within integration tenant, using raw/normalized variants; first-created match wins. |
| Unknown caller lead creation | BUILT | Creates through normal `processLeadEnquiry`; name/company use caller name or “Unknown caller” and normalized number; placement uses a sales user/project where available. |
| Call log / duplicate receipt | BUILT | Creates inbound CallDetail, then a receipt unique per tenant/provider call ID. Repeated ID returns the existing result. |
| Missed-call notification | NOT BUILT in telephony-specific path | No telephony missed-call notification is sent by `ingestTelephonyCall`. |
| Follow-up creation | NOT BUILT in telephony-specific path | No telephony follow-up is created by the inbound service. |
| Recording retrieval/playback | NOT BUILT | A validated `http(s)` recording URL up to 255 characters is stored in `recordingFile`; no fetch, download, or playback flow is present in this receiver. |
| Inbound dialpad event handling | UNKNOWN (needs Bizcall confirmation) | The dock accepts only the listed generic call events and uses active local call context; no separate incoming-call event is declared. Whether Bizcall emits generic events for inbound calls is unknown. |

The internal webhook URL has the form `/api/integrations/telephony/<integrationKey>/lead`; the key is sent in the URL path. Management routes are super-admin only; create/rotate returns the raw key once, while the database stores `keyHash` and `keyPrefix`. No request signature is checked. Accepted payload aliases include `callerNumber`/`caller`/`from`, `calledNumber`/`to`, `callId`/`call_id`, `callStatus`/`status`, `recordingUrl`/`recording_url`, `callerName`/`name`, plus `agent` and `duration`. Unknown fields are stripped. `callId` and caller number are required. Status aliases map missed/no-answer to `NO_ANSWER`, busy to `BUSY`, voicemail to `VOICEMAIL`, cancellation/failure to `CANCELLED`; everything else maps to `COMPLETED`. Evidence: `inboundSchema`, `parseInboundCall`, `callStatus`, `ingestTelephonyCall` in `apps/api/src/services/telephonyInbound.ts`; POST handler in `apps/api/src/routes/telephonyWebhook.ts`.

No evidence proves that Bizcall calls this CRM webhook, uses these field names, or sends a particular status vocabulary. Those are **UNKNOWN (needs Bizcall confirmation)**.

## G. Settings and configuration

**Status: BUILT** — admin settings API and UI exist. Stored values are not proof that production has usable values.

| Setting | Default / validation | Purpose and reader |
|---|---|---|
| `clickToCallUrl` | Bizcall click2call URL; required 1–500 chars; HTTP(S), no URL credentials or `api_key` query; production requires HTTPS; local/private hosts blocked except dev + allowTestUrl. | REST endpoint; `assertClickToCallUrl` / `placeClickToCall`. |
| `authHeaderName` | `X-API-KEY`; 1–64 alphanumeric/hyphen, reserved headers rejected. | Header name for decrypted token. |
| `authToken` | Optional in update API; up to 2000 chars. | Encrypted before persistence; blank/masked input keeps current key. |
| `callerId` | Empty/nullable, up to 80 chars. | Optional `callerId` REST JSON field. |
| `useBearerPrefix`, `noAuthRequired` | Schema defaults false; save routine writes false. | Present in model/schema/public settings but currently not used to alter outbound auth behavior. |
| `allowTestUrl` | false | Allows localhost/private host only in development when true. |
| `callIdFieldPath` | `originateUuid`; dotted identifier path up to 120 chars. | Reads provider call ID from response. |
| `isActive` | false | Must have encrypted key to be activated. |
| `extraHeaders` | Up to three; names validated, values required or retained from prior masked value. | Encrypted in `encryptedExtraHeaders`; outbound `buildOutboundHeaders` currently does not read/send these headers. |
| `dialpadUrl` | Default Bizcall embed URL; host must be `bizcall.cxteletech.com`; production HTTPS. | Client config/iframe and CSP configuration. |
| `dialpadMode` | `DOCKED`; `DOCKED` or `NEW_TAB` | Iframe presentation. |
| `callMethod` | `SERVER_API`; `SERVER_API` or `DIALPAD_MESSAGE`; message mode requires docked mode. | Chooses one outbound flow. |
| `defaultDockState` | `COLLAPSED`; `COLLAPSED` or `EXPANDED` | Initial dock presentation. |
| `theme` | `CRM`; `CRM`, `LIGHT`, `DARK` | Dialpad URL theme query. |
| `productionOrigin` | Empty; if supplied must be HTTPS origin without path. | Stored/admin-visible; not used by the actual iframe bridge to set its target origin. |
| `duplicateGuardSeconds` | 10; integer 1–120 | Duplicate call guard. |
| `callsPerMinute` | 10; integer 1–60 | Per-user call rate limit. |
| `maskNumbers` | false | Client-side masking of displayed lead phone numbers when active/permitted. |
| `sendTenantIdInDial` | true | Whether DIAL postMessage includes tenantId. |
| `blockDnc`, `dncNumbers` | false, empty; DNC entries must be E.164 `+` numbers of 8–15 digits. | Blocks outbound REST and dialpad calls if enabled. |

Evidence: `telephonySettingsSchema`, `saveTelephonySettings`, `publicTelephonySettings` in `apps/api/src/services/telephonySettings.ts`; `buildOutboundHeaders` and `placeClickToCall` in `apps/api/src/services/clickToCall.ts`; Telephony Setup form in `apps/web/src/app/(dashboard)/setup/integrations/telephony/page.tsx`.

**Environment variables**

| Name | Behavior |
|---|---|
| `API_KEY_ENCRYPTION_SECRET` | Required for v2 AES-256-GCM key encryption/decryption; must decode from base64 to 32 bytes. Missing/invalid prevents reading/saving credentials. |
| `TELEPHONY_CREDENTIALS_KEY` | Legacy v1 decryption only; absent legacy key prevents old credential decryption. |
| `DIALPAD_URL` | Web CSP default dialpad origin and API default dialpad URL; production web config rejects non-HTTPS. API setting validation restricts dialpad hostname to the approved Bizcall host. |
| `BACKEND_URL` | Next.js proxy target; required outside development (dev has localhost fallback). |
| `PUBLIC_API_BASE_URL`, `ALLOWED_API_HOSTS` | Used for public API base URL discovery in Setup/environment diagnostics. |
| `DATABASE_URL` | Prisma datasource for the application; not read or exposed for this report. |
| `JWT_SECRET` | Used by API session authentication; not telephony-specific, but protects the identity/tenant used by telephony routes. |

Evidence: `apps/api/src/services/telephonyCredentials.ts` (`keyBytes`, `encryptTelephonyToken`, `decryptTelephonyToken`); `apps/api/src/services/publicApiBaseUrl.ts`; `apps/api/src/middleware/auth.ts` (`authenticate`); `apps/web/src/app/api/proxy/[...path]/route.ts`; `apps/web/next.config.js`.

Credentials use AES-256-GCM with random IV and authentication tag. API responses expose `hasKey` and `keyLastFour`, not the key; settings audit records booleans/key-changed state and extra-header names, not values. Outbound request uses the decrypted key in the configured header. Evidence: `telephonyCredentials.ts`; `publicTelephonySettings` / `saveTelephonySettings`; `buildOutboundHeaders`.

## H. Permissions and security

### Permission definition, grants and cache

**Status: BUILT** — permission is a catalog row, not a PostgreSQL enum. Exact catalog is `public."Permission"` with `"name"`; `TELEPHONY_CALL` maps to other catalog fields (`label`, `module`, `action`, etc.). Profile grants are rows in `public."UserProfilePermission"` with `profileId` and `permissionId`; direct grants use `public."UserDirectPermission"`. Evidence: Prisma `Permission`, `UserProfilePermission`, and `UserDirectPermission` models; `EffectivePermissionService`.

The setup Grant routes are `PUT /api/setup/telephony/agents` and `/api/setup/telephony/agents/grant-default-profiles`. They require administrator. Profile grants are written to `UserProfilePermission`; single-user grants are written to `UserDirectPermission` and an agent override row. The default profile grant matches `isAdmin` or profile names Admin, Sales, Presales, Pre-Sales, and System Administrator (case-insensitive). Grants are audited. When the permission catalog row is absent, admins receive an explicit message naming `public."Permission"."name" = TELEPHONY_CALL` and `TELEPHONY_AWS_FIX.md`; missing Permission table has a separate message. Evidence: `apps/api/src/routes/setup/telephony.ts` (`permissionUnavailableResponse`, `PUT /agents`, `PUT /agents/grant-default-profiles`).

`EffectivePermissionService.hasPermission` first checks the definition and returns false if missing; this emits one process-wide server warning. The effective permissions cache is request-scoped via a WeakMap keyed by request owner; grants increment a revision so subsequent request computations are fresh. Per-user `canUse=false` override denies an otherwise effective grant. Client auth state can still be stale temporarily; the dock polls and refreshes auth when server config sees permission granted. Evidence: `apps/api/src/services/effectivePermissions.ts` (`isTelephonyPermissionConfigured`, `warnTelephonyPermissionUnavailable`, `hasPermission`, cache methods); dock `load` effect.

### Tenant, identity and access controls

- Browser session identity and tenant derive from the signed JWT and database User record in `authenticate`; optional requested tenant is restricted to that tenant except super-admin selection, which is audited. Impersonation constrains tenant and identity. Telephony click, dialpad, and settings routes use `req.user`/`req.tenantId`, not browser-supplied identity. Evidence: `apps/api/src/middleware/auth.ts` (`authenticate`).
- Click-to-call and dialpad routes tenant-scope lead/call/settings queries and check lead visibility using `canAccessLead`. The inbound webhook tenant is derived from the matched integration row, not its payload. The webhook-created call's creator is the integration creator. Evidence: `clickToCall.ts`; `telephonyClickToCall.ts`; `telephonyWebhook.ts`; `telephonyIntegration.ts`.
- Dialpad browser events are origin/source-checked in the dock, but the API route itself uses authentication/permission, not provider signature verification. Anyone with an authenticated permitted session can call the event endpoint directly.
- Impersonation disables the dock/browser call handler; authenticated API middleware also checks impersonation restrictions. The UI can show a disabled state rather than a clickable phone.
- Click-to-call and event rate/duplicate guards are in process memory, not shared across API replicas and reset on process restart.
- Audit entries for click and dialpad calls mask phone numbers; dialpad browser monitor masks phone/email and redacts notes/secrets. Outbound request logs store masked number/reason. CallDetail stores full normalized `callTo`/`callFrom`, notes, and inbound `recordingFile`; this is not globally redacted.
- Integration keys are bearer secrets in the URL path. The current API logging middleware redacts that path segment in its own request log, but proxies/access logs outside this middleware may still record URLs. No HMAC signature is required.
- SSRF controls reject URL credentials, API-key query strings, unsupported schemes, production HTTP, and literal/private hostname patterns for click URL. The click host is not pinned to Bizcall and hostname DNS resolution is not checked against private IPs. Dialpad URL is restricted to the Bizcall hostname. These are controls, not proof against DNS-based rebinding or provider redirects (redirects are not followed).
- `productionOrigin` is validated and stored, but is not used as an allowlist in the bridge. Embedding check fetches the configured Bizcall URL with GET/manual redirect and examines `frame-ancestors` / `X-Frame-Options`; it does not change provider policy.

Evidence: `apps/api/src/services/telephonyUrl.ts`; `apps/api/src/services/telephonyEmbedding.ts`; `apps/api/src/index.ts` (request-log redaction); `apps/web/src/lib/bizcall-dialpad.ts` (origin/source check and monitor sanitization).

## I. Status rules and side effects

**Status: BUILT AND WORKING** — both outbound lead-call start and inbound call logging invoke the same status rule.

When a call log is saved for a lead in `NEW`, `applyCallLogStatusRule` updates it to `INCOMING`, creates a `STATUS_CHANGE` audit record and appends a lead process note. It does not downgrade any non-NEW status. The REST outbound path invokes this after saving a CallDetail; the dialpad path invokes it on call start; inbound invokes it after creating its CallDetail. Evidence: `apps/api/src/services/callLogStatus.ts` (`applyCallLogStatusRule`); `recordClickAttempt` in `clickToCall.ts`; dialpad `/dialpad-call-started` and `/dialpad-event`; `storeFor` / `ingestTelephonyCall` in `telephonyIntegration.ts` and `telephonyInbound.ts`.

Disposition submission appends a lead process note with disposition and optional notes. The inbound receiver creates a lead via normal enquiry processing when no phone match exists. No telephony-specific follow-up or notification creation was found; any generic side effects inside `processLeadEnquiry` are outside the telephony-specific writer and are not represented as a telephony missed-call workflow. Evidence: `/dialpad-event` in `telephonyClickToCall.ts`; `storeFor.createLead` in `telephonyIntegration.ts`.

## J. Environment and deployment state

**Status: UNKNOWN** for live local/AWS rows and production behavior. This report did not connect to either database or AWS.

Known from source tree:

- The Prisma schema contains `TelephonySetting`, `CallDetail` telephony fields, integration/receipt/request-log models, and `TELEPHONY_CALL` as an expected `Permission` row.
- Telephony-related migration folders exist in the repository, including `20261030100000_click_to_call_settings`, `20261029170000_telephony_integrations`, and `20261103000000_telephony_permission_repair`. File presence does not prove a database has applied them or that `_prisma_migrations` history is consistent.
- `scripts/check-telephony-permission.sql`, `scripts/repair-telephony-permission.sql`, and `scripts/check-telephony-permission.sh` exist in the working tree. Root `package.json` exposes `db:repair-telephony` and `postdeploy:check-telephony`. I did not verify that a deployment pipeline invokes the check automatically.
- HTTPS is enforced by URL validation in production and for the production dialpad configuration. Actual CRM production origin, allowed Bizcall framing origin, API base URL, key-encryption secret presence, AWS table/permission rows, and migration history could not be verified without environment/database access.

No migration deploy/reset, database query, or AWS operation was performed for this report. Evidence: repository migration/script files; `package.json`; `assertClickToCallUrl` / `assertDialpadUrl`; Setup `environment-check` route in `apps/api/src/routes/setup/telephony.ts`.

## K. Test coverage

**Status: PARTIAL.** Focused telephony tests were run for this report; they are not proof of integration with Bizcall.

| Test file | Assertions covered / result |
|---|---|
| `apps/api/src/services/clickToCall.test.ts` | REST payload, guards, provider handling, masking/credentials and helper behavior; 23 passed. |
| `apps/api/src/routes/telephonyClickToCall.test.ts` | client config, click-to-call and dialpad routes/events; 13 passed. |
| `apps/api/src/services/effectivePermissions.field.test.ts` | permission semantics including missing TELEPHONY_CALL definition/warning and override behavior; 16 passed. |
| `apps/api/src/services/telephonyInbound.test.ts` | inbound parsing/status/phone match behavior; 2 passed. |
| `apps/api/src/services/telephonySettings.test.ts` | settings schema/public mapping/save behavior; 6 passed. |
| `apps/api/src/services/telephonyUrl.test.ts` | URL validation; 3 passed. |
| `apps/api/src/routes/setupTelephony.test.ts`, `apps/api/src/routes/setup/telephony.embedding.test.ts` | settings/setup route authorization and permission repair behavior; 3 passed total. |
| `apps/web/src/lib/bizcall-dialpad.test.ts` | dialpad URL, locking, origin, and sanitization helpers; 9 passed. |
| `apps/web/src/components/crm/telephony-status-hint.test.tsx` | hint reasons/admin links; 4 passed. |
| `apps/web/src/components/crm/bizcall-dialpad-dock.test.tsx` | blocked dock state; 1 test failed before assertions because the test's `@/lib/api` mock does not export the newly referenced `impersonationMeta`. |

Run result: all 8 selected API test files passed (66 tests); 2 of 3 selected web files passed, with 13 passing and 1 failing as described. The full repository test suite was not run. Not covered by these focused tests: live Bizcall compatibility, real iframe CSP/Permissions-Policy behavior, real inbound callback/signature behavior, AWS migration state, distributed rate limits, or cross-device dialpad locking.

## L. Gaps, risks and recommendations

| Gap or risk | Evidence | Impact | Suggested fix | Priority |
|---|---|---|---|---|
| AWS migration/permission state is unverified | J; `Permission` and telephony migration files do not establish deployment state. | Production can still lack the catalog row/tables or have inconsistent migration history. | Use the read-only check and reviewed repair/runbook against a snapshot-backed direct RDS connection; never blind-deploy/reset. | high |
| Inbound integration key is in URL path; no signature check | `telephonyWebhook.ts`; integration key management in `companyTelephony.ts`. | URL may be captured by upstream access logs; a stolen key can submit inbound calls. | Prefer header-based secret plus HMAC/timestamp and key rotation; ensure every proxy log redacts path tokens. | high |
| In-memory duplicate/rate guards are per process | `clickToCall.ts`; `telephonyClickToCall.ts`. | Multiple API replicas can exceed configured rate/duplicate limits; restart clears guard state. | Move guards to shared atomic storage (for example Redis/database reservation). | medium |
| Provider identity mapping is not verified | REST payload sends CRM `userId`; `DIAL` sends CRM userId only in INIT_USER. Agent list says `registeredInBizcall: 'unknown'`. | Calls can fail or route to wrong/unregistered provider agent. | Confirm Bizcall's identity contract; surface registration status from a supported provider API. | high |
| Missing extra-auth-header transmission | Settings encrypt and expose extra-header metadata, but `buildOutboundHeaders` sends only Content-Type and the configured main auth header. | Configured supplemental headers have no effect. | Either wire encrypted headers into request or remove/disable the setting and document the supported contract. | medium |
| Legacy auth toggles do not affect requests | `useBearerPrefix` and `noAuthRequired` are stored/public but save writes false and outbound header builder always adds the configured key when present. | UI/API values can imply unsupported auth modes. | Remove unsupported fields or implement and test the semantics explicitly. | medium |
| Full phone numbers remain in CallDetail | `recordClickAttempt`, dialpad call creation, inbound `storeFor`. | Database access exposes phone data even when UI/logs are masked. | Apply access controls/retention and consider encryption or least-privilege data handling. | medium |
| Recording handling is only a URL field | Inbound parser accepts a URL and stores it in `recordingFile`; no retrieval/playback/expiry is implemented there. | Recording availability, URL safety, and retention are unmanaged. | Confirm provider recording URL/auth/expiry requirements; define secured access and retention before enabling playback. | medium |
| No telephony missed-call notification or follow-up | `ingestTelephonyCall` writes lead/call/receipt but has no telephony notification/follow-up path. | Agents may not be alerted to missed calls. | Add an explicit workflow after product requirements and provider status mapping are confirmed. | medium |
| Agent registration is not authoritative | Setup agent list hardcodes `registeredInBizcall: 'unknown'`; UI iframe registration is per session. | Admin can grant permission without knowing whether provider agent is configured. | Add supported server-side Bizcall registration check or clearly label registration as unknown. | medium |
| No proven provider inbound contract / generic iframe inbound semantics | CRM accepts a payload contract and generic outgoing call events, but no provider documentation/test evidence. | Inbound calls may not arrive, map correctly, or have expected status/disposition. | Confirm accepted webhook payload, signatures, retry policy and iframe event contract with Bizcall. | high |
| Dialpad events have browser origin checks but no API signature | Browser verifies iframe source/origin; authenticated API endpoint accepts event calls from permitted sessions. | A permitted user can forge event payloads directly to the API. | Bind events to a server-issued call/session nonce and validate transitions server-side. | medium |
| URL SSRF guard does not resolve hostnames | `isPrivateHostname` checks hostname strings/literal IP ranges, not DNS answers. | A public hostname resolving to a private address is not blocked by this helper. | Resolve and validate all destination addresses at connection time, pin/allowlist provider hosts, and handle DNS changes safely. | medium |
| No cross-device dialpad lock | Lock is localStorage/BroadcastChannel scoped to browser origin. | Same agent can have simultaneous dialpads on another device/browser. | Use provider-supported agent session control or shared server lock if cross-device exclusivity is required. | low |
| Web dock test mock is stale | `bizcall-dialpad-dock.test.tsx` throws because `@/lib/api` mock omits `impersonationMeta`; 1 focused test fails. | Dock behavior regression may be masked by a test that cannot render. | Update the test mock and rerun focused/full suites. | medium |

## M. Questions requiring Bizcall confirmation

Each item below is **UNKNOWN (needs Bizcall confirmation)**:

1. Does `/api/integration/click2call` accept the exact JSON fields `userId`, `customerNumber`, `recordId`, `leadName`, and optional `callerId`? Are names/casing and value formats exact?
2. Is the custom configured auth header (default `X-API-KEY`) the supported authentication mechanism? Are supplemental headers required?
3. Does HTTP 200 with `{ "success": true }` define successful call initiation, and which errors/status codes/body fields can be returned?
4. Is `originateUuid` the correct response call-ID field, and is it stable/unique?
5. What is the meaning/required format of the REST `userId`? Does it identify a Bizcall agent or a CRM user?
6. What URL query parameters does the iframe support? Does it recognize `userId` and `theme` as currently sent?
7. Does the iframe accept `INIT_USER`, `DIAL`, and `BIZCALL_HANGUP` with the exact shapes above, and is `tenantId` supported/needed in `DIAL`?
8. Does Bizcall emit each of the five registered iframe events with the fields the CRM expects? Can it emit incoming-call events through these same names?
9. Does Bizcall permit `https://crm.cxteletech.com` as an iframe parent via CSP `frame-ancestors`/`X-Frame-Options`, and does the iframe support microphone permissions in that origin?
10. Does Bizcall call the CRM integration-key URL for inbound calls? What HTTP method, retry/timeout behavior, signature/header authentication, payload aliases, call-status vocabulary, and recording URL lifecycle does it support?
11. How does Bizcall identify an unregistered agent, and what exact response or iframe event signals that condition?
12. Does Bizcall provide an agent-registration lookup API or reliable webhook/event to replace the CRM's current `registeredInBizcall: unknown` value?

## N. Quick reference

### Click-to-call in eight steps

1. Lead detail/list checks client effective permission and active telephony state.
2. User selects a phone field; browser posts only `leadId` and `phoneField`.
3. Next proxy forwards to the authenticated Express API.
4. API checks TELEPHONY_CALL, tenant-scoped lead existence, and lead visibility.
5. API normalizes selected phone to E.164 and checks active settings, key, DNC, URL, duplicate and rate limits.
6. `SERVER_API` sends REST JSON; `DIALPAD_MESSAGE` creates a pending CallDetail then sends `DIAL` to the dock.
7. API records provider outcome or dialpad events and updates CallDetail/audit information.
8. If the lead was NEW, the shared call-log rule changes it to INCOMING and adds audit/process-note history.

### Outbound REST payload

```json
{
  "userId": "<authenticated CRM user id>",
  "customerNumber": "+91XXXXXXXXXX",
  "recordId": "<leadId>",
  "leadName": "<lead name>",
  "callerId": "<optional configured caller id>"
}
```

Headers: `Content-Type`; configured auth header name (default `X-API-KEY`). No REST `tenantId`, `agentId`, or `taskId`.

### Dialpad command/event table

| Direction | Name | Essential fields / CRM effect |
|---|---|---|
| CRM -> Bizcall | `INIT_USER` | Authenticated `userId`; sent on iframe load. |
| CRM -> Bizcall | `DIAL` | E.164 `number`, lead `recordId`, `leadName`; optional `taskId`, default-on optional `tenantId`. |
| CRM -> Bizcall | `BIZCALL_HANGUP` | Type only; sent on hangup/close/teardown. |
| Bizcall -> CRM | `BIZCALL_AGENT_REGISTERED` | `name`, `extension`; marks dock ONLINE and audits registration. |
| Bizcall -> CRM | `BIZCALL_CALL_STARTING` | `number`; creates/matches call and may set Calling. |
| Bizcall -> CRM | `BIZCALL_CALL_CONNECTED` | `number`, `callUuid`; sets Connected/answeredAt. |
| Bizcall -> CRM | `BIZCALL_CALL_ENDED` | `duration`, `durationFormatted`; sets Ended/endAt/duration. |
| Bizcall -> CRM | `BIZCALL_DISPOSITION_SUBMITTED` | `disposition`, optional `notes`; updates disposition/notes and process note. |

### Inbound handling quick table

| Capability | Current state |
|---|---|
| Integration-key webhook receiver | BUILT (`POST /api/integrations/telephony/:integrationKey/lead`) |
| HMAC/signature verification | NOT BUILT |
| Tenant resolution | Built from integration record |
| Existing-lead phone matching | BUILT, tenant-scoped |
| Unknown caller lead creation | BUILT through normal enquiry processing |
| Inbound CallDetail + idempotency receipt | BUILT |
| Missed-call notification / telephony follow-up | NOT BUILT in telephony-specific flow |
| Recording download/playback | NOT BUILT; URL only may be stored |
| Bizcall webhook/event contract | UNKNOWN (needs Bizcall confirmation) |

### Settings to fill in

1. Click-to-call URL (if using REST) and auth header name/API key.
2. Enable telephony only after saving the key.
3. Select `SERVER_API` or docked `DIALPAD_MESSAGE`; message mode requires Docked.
4. Set the approved Bizcall dialpad URL, mode, dock state, and theme.
5. Optionally set caller ID, call-ID response path, duplicate/rate limits, number masking, DNC list/blocking, and whether to include tenantId in DIAL.
6. Ensure API `API_KEY_ENCRYPTION_SECRET`, web `BACKEND_URL`/`DIALPAD_URL`, HTTPS and provider framing permissions are correctly configured.

Evidence: Setup schema and save path in `apps/api/src/services/telephonySettings.ts`; form in `apps/web/src/app/(dashboard)/setup/integrations/telephony/page.tsx`.
