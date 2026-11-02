import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { auditLog } from '../middleware/audit';
import { decryptTelephonyToken, encryptTelephonyToken, TelephonyCredentialError } from './telephonyCredentials';
import { assertClickToCallUrl, assertDialpadUrl, DEFAULT_CLICK_TO_CALL_URL, DEFAULT_DIALPAD_URL } from './telephonyUrl';

const headerNameSchema = z.string().trim()
  .regex(/^[A-Za-z0-9-]{1,64}$/, 'Enter a header name such as Authorization or X-API-Key')
  .refine(
    (value) => !['content-type', 'content-length', 'host', 'connection', 'transfer-encoding'].includes(value.toLowerCase()),
    'Choose a header name reserved for API authentication.',
  );
const callIdPathSchema = z.string().trim().max(120).refine(
  (value) => value === '' || /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value),
  'Enter a call id path such as callId or data.callId',
);

export const telephonySettingsSchema = z.object({
  clickToCallUrl: z.string().trim().min(1).max(500),
  authHeaderName: headerNameSchema.default('X-API-KEY'),
  callerId: z.string().trim().max(80).optional(),
  useBearerPrefix: z.boolean().default(false),
  noAuthRequired: z.boolean().default(false),
  allowTestUrl: z.boolean().default(false),
  callIdFieldPath: callIdPathSchema.default('originateUuid'),
  isActive: z.boolean().default(false),
  dialpadUrl: z.string().trim().min(1).max(500).default(DEFAULT_DIALPAD_URL),
  dialpadMode: z.enum(['DOCKED', 'NEW_TAB']).default('DOCKED'),
  callMethod: z.enum(['SERVER_API', 'DIALPAD_MESSAGE']).default('SERVER_API'),
  defaultDockState: z.enum(['COLLAPSED', 'EXPANDED']).default('COLLAPSED'),
  theme: z.enum(['CRM', 'LIGHT', 'DARK']).default('CRM'),
  productionOrigin: z.string().trim().max(500).optional().default(''),
  duplicateGuardSeconds: z.number().int().min(1).max(120).default(10),
  callsPerMinute: z.number().int().min(1).max(60).default(10),
  maskNumbers: z.boolean().default(false),
  sendTenantIdInDial: z.boolean().default(true),
  blockDnc: z.boolean().default(false),
  dncNumbers: z.string().max(100_000).default(''),
  authToken: z.string().max(2000).optional(),
  extraHeaders: z.array(z.object({
    name: z.string().trim().max(64).default(''),
    value: z.string().max(2000).optional(),
  })).max(3).optional(),
}).refine(
  (settings) => settings.dialpadMode !== 'NEW_TAB' || settings.callMethod !== 'DIALPAD_MESSAGE',
  { message: 'Dialpad message mode requires the docked panel.' },
);

export type ExtraHeaderPublic = { name: string; hasValue: boolean };
export type TelephonyStatus = 'not_configured' | 'active' | 'inactive';

export type PublicTelephonySettings = {
  clickToCallUrl: string;
  authHeaderName: string;
  callerId: string;
  useBearerPrefix: boolean;
  noAuthRequired: boolean;
  allowTestUrl: boolean;
  callIdFieldPath: string;
  isActive: boolean;
  hasKey: boolean;
  keyLastFour: string;
  extraHeaders: ExtraHeaderPublic[];
  status: TelephonyStatus;
  statusLabel: string;
  dialpadUrl: string;
  dialpadOrigin: string;
  dialpadMode: 'DOCKED' | 'NEW_TAB';
  callMethod: 'SERVER_API' | 'DIALPAD_MESSAGE';
  defaultDockState: 'COLLAPSED' | 'EXPANDED';
  theme: 'CRM' | 'LIGHT' | 'DARK';
  productionOrigin: string;
  duplicateGuardSeconds: number;
  callsPerMinute: number;
  maskNumbers: boolean;
  sendTenantIdInDial: boolean;
  blockDnc: boolean;
  dncNumbers: string;
};

type StoredExtraHeader = { name: string; value: string };

function statusFor(row: { clickToCallUrl: string; isActive: boolean; encryptedCredentials: string | null } | null): TelephonyStatus {
  if (!row || !row.clickToCallUrl.trim() || !row.encryptedCredentials) return 'not_configured';
  if (!row.isActive) return 'inactive';
  return 'active';
}

const STATUS_LABEL: Record<TelephonyStatus, string> = {
  not_configured: 'Key missing',
  active: 'Configured and active',
  inactive: 'Inactive',
};

function publicClickToCallUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase() === 'api_key') url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function readExtraHeaders(encrypted: string | null): StoredExtraHeader[] {
  if (!encrypted) return [];
  const parsed = JSON.parse(decryptTelephonyToken(encrypted));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item.name === 'string' && typeof item.value === 'string' && item.name && item.value)
    .slice(0, 3)
    .map((item) => ({ name: item.name, value: item.value }));
}

export function publicTelephonySettings(row: {
  clickToCallUrl: string;
  authHeaderName: string;
  callerId?: string | null;
  useBearerPrefix: boolean;
  noAuthRequired: boolean;
  allowTestUrl: boolean;
  callIdFieldPath: string;
  isActive: boolean;
  encryptedCredentials: string | null;
  keyLast4?: string | null;
  encryptedExtraHeaders: string | null;
  dialpadUrl?: string;
  dialpadMode?: string;
  callMethod?: string;
  defaultDockState?: string;
  theme?: string;
  productionOrigin?: string | null;
  duplicateGuardSeconds?: number;
  callsPerMinute?: number;
  maskNumbers?: boolean;
  sendTenantIdInDial?: boolean;
  blockDnc?: boolean;
  dncNumbers?: string;
} | null): PublicTelephonySettings {
  if (!row) {
    return {
      clickToCallUrl: DEFAULT_CLICK_TO_CALL_URL,
      authHeaderName: 'X-API-KEY',
      callerId: '',
      useBearerPrefix: false,
      noAuthRequired: false,
      allowTestUrl: false,
      callIdFieldPath: '',
      isActive: false,
      hasKey: false,
      keyLastFour: '',
      extraHeaders: [],
      status: 'not_configured',
      statusLabel: STATUS_LABEL.not_configured,
      dialpadUrl: DEFAULT_DIALPAD_URL,
      dialpadOrigin: new URL(DEFAULT_DIALPAD_URL).origin,
      dialpadMode: 'DOCKED',
      callMethod: 'SERVER_API',
      defaultDockState: 'COLLAPSED',
      theme: 'CRM',
      productionOrigin: '',
      duplicateGuardSeconds: 10,
      callsPerMinute: 10,
      maskNumbers: false,
      sendTenantIdInDial: true,
      blockDnc: false,
      dncNumbers: '',
    };
  }
  let extraHeaders: ExtraHeaderPublic[] = [];
  if (row.encryptedExtraHeaders) {
    try {
      extraHeaders = readExtraHeaders(row.encryptedExtraHeaders).map((item) => ({ name: item.name, hasValue: true }));
    } catch {
      extraHeaders = [];
    }
  }
  const status = statusFor(row);
  const statusLabel = !row
    ? 'Not configured'
    : status === 'not_configured' && !row.encryptedCredentials
      ? 'Key missing'
      : status === 'not_configured'
        ? 'Not configured'
        : STATUS_LABEL[status];
  return {
    clickToCallUrl: publicClickToCallUrl(row.clickToCallUrl),
    authHeaderName: row.authHeaderName,
    callerId: row.callerId || '',
    useBearerPrefix: row.useBearerPrefix,
    noAuthRequired: row.noAuthRequired,
    allowTestUrl: row.allowTestUrl,
    callIdFieldPath: row.callIdFieldPath,
    isActive: row.isActive,
    hasKey: Boolean(row.encryptedCredentials),
    keyLastFour: row.keyLast4 || '',
    extraHeaders,
    status,
    statusLabel,
    dialpadUrl: row.dialpadUrl || DEFAULT_DIALPAD_URL,
    dialpadOrigin: new URL(row.dialpadUrl || DEFAULT_DIALPAD_URL).origin,
    dialpadMode: (row.dialpadMode || 'DOCKED') as 'DOCKED' | 'NEW_TAB',
    callMethod: (row.callMethod || 'SERVER_API') as 'SERVER_API' | 'DIALPAD_MESSAGE',
    defaultDockState: (row.defaultDockState || 'COLLAPSED') as 'COLLAPSED' | 'EXPANDED',
    theme: (row.theme || 'CRM') as 'CRM' | 'LIGHT' | 'DARK',
    productionOrigin: row.productionOrigin || '',
    duplicateGuardSeconds: row.duplicateGuardSeconds ?? 10,
    callsPerMinute: row.callsPerMinute ?? 10,
    maskNumbers: row.maskNumbers ?? false,
    sendTenantIdInDial: row.sendTenantIdInDial ?? true,
    blockDnc: row.blockDnc ?? false,
    dncNumbers: row.dncNumbers || '',
  };
}

export async function getTelephonySettings(tenantId: string) {
  const row = await prisma.telephonySetting.findUnique({ where: { tenantId } });
  return publicTelephonySettings(row);
}

export async function saveTelephonySettings(
  tenantId: string,
  userId: string,
  input: z.infer<typeof telephonySettingsSchema>,
) {
  const clickToCallUrl = assertClickToCallUrl(input.clickToCallUrl, { allowTestUrl: input.allowTestUrl });
  const dialpadUrl = assertDialpadUrl(input.dialpadUrl);
  const dncNumbers = [...new Set(input.dncNumbers.split(/[\s,;]+/).map((number) => number.trim()).filter(Boolean))];
  if (dncNumbers.some((number) => !/^\+[1-9]\d{7,14}$/.test(number))) {
    throw new Error('DNC entries must be valid E.164 numbers (for example +14155552671).');
  }
  const productionOrigin = input.productionOrigin.trim();
  if (productionOrigin) {
    let origin: URL;
    try {
      origin = new URL(productionOrigin);
    } catch {
      throw new Error('Enter a valid production CRM origin.');
    }
    if (origin.protocol !== 'https:' || origin.origin !== productionOrigin.replace(/\/$/, '')) {
      throw new Error('Production origin must be an HTTPS origin without a path.');
    }
  }
  const existing = await prisma.telephonySetting.findUnique({ where: { tenantId } });
  const submittedToken = input.authToken?.trim() || '';
  const nextToken = /^•+$/.test(submittedToken) ? '' : submittedToken;
  const existingToken = !nextToken && existing?.encryptedCredentials
    ? decryptTelephonyToken(existing.encryptedCredentials)
    : '';
  const encryptedCredentials = nextToken
    ? encryptTelephonyToken(nextToken)
    : existingToken
      ? encryptTelephonyToken(existingToken)
      : null;
  const keyLast4 = nextToken
    ? nextToken.slice(-4)
    : existing?.keyLast4 || existingToken.slice(-4);
  if (input.isActive && !encryptedCredentials) {
    throw new Error('Enter the Bizcall API key before turning telephony on.');
  }
  if (!input.clickToCallUrl.trim()) {
    throw new Error('Enter the click-to-call URL.');
  }

  const previousExtras = existing?.encryptedExtraHeaders ? readExtraHeaders(existing.encryptedExtraHeaders) : [];
  const submitted = (input.extraHeaders || []).filter((item) => item.name.trim()).slice(0, 3);
  const names = new Set<string>();
  const nextExtras: StoredExtraHeader[] = [];
  for (const item of submitted) {
    const name = item.name.trim();
    if (!headerNameSchema.safeParse(name).success) {
      throw new Error(`Header name "${name}" is not valid.`);
    }
    if (names.has(name.toLowerCase())) throw new Error(`Header ${name} is listed twice.`);
    names.add(name.toLowerCase());
    const submittedValue = item.value?.trim() || '';
    const value = submittedValue && !/^•+$/.test(submittedValue)
      ? submittedValue
      : previousExtras.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
    if (!value) throw new Error(`Enter a value for the ${name} header.`);
    nextExtras.push({ name, value });
  }
  const encryptedExtraHeaders = nextExtras.length ? encryptTelephonyToken(JSON.stringify(nextExtras)) : null;

  const saved = await prisma.telephonySetting.upsert({
    where: { tenantId },
    create: {
      tenantId,
      clickToCallUrl,
      authHeaderName: input.authHeaderName,
      callerId: input.callerId?.trim() || null,
      useBearerPrefix: false,
      noAuthRequired: false,
      allowTestUrl: input.allowTestUrl,
      callIdFieldPath: input.callIdFieldPath,
      isActive: input.isActive,
      updatedById: userId,
      encryptedCredentials,
      keyLast4,
      encryptedExtraHeaders,
      dialpadUrl,
      dialpadMode: input.dialpadMode,
      callMethod: input.callMethod,
      defaultDockState: input.defaultDockState,
      theme: input.theme,
      productionOrigin: productionOrigin || null,
      duplicateGuardSeconds: input.duplicateGuardSeconds,
      callsPerMinute: input.callsPerMinute,
      maskNumbers: input.maskNumbers,
      sendTenantIdInDial: input.sendTenantIdInDial,
      blockDnc: input.blockDnc,
      dncNumbers: dncNumbers.join('\n'),
    },
    update: {
      clickToCallUrl,
      authHeaderName: input.authHeaderName,
      callerId: input.callerId?.trim() || null,
      useBearerPrefix: false,
      noAuthRequired: false,
      allowTestUrl: input.allowTestUrl,
      callIdFieldPath: input.callIdFieldPath,
      isActive: input.isActive,
      updatedById: userId,
      encryptedCredentials,
      keyLast4,
      encryptedExtraHeaders,
      dialpadUrl,
      dialpadMode: input.dialpadMode,
      callMethod: input.callMethod,
      defaultDockState: input.defaultDockState,
      theme: input.theme,
      productionOrigin: productionOrigin || null,
      duplicateGuardSeconds: input.duplicateGuardSeconds,
      callsPerMinute: input.callsPerMinute,
      maskNumbers: input.maskNumbers,
      sendTenantIdInDial: input.sendTenantIdInDial,
      blockDnc: input.blockDnc,
      dncNumbers: dncNumbers.join('\n'),
    },
  });

  const auditable = (
    settings: typeof input,
    resolvedClickUrl: string,
    resolvedDialpadUrl: string,
    keySaved: boolean,
    dncCount: number,
    dncChanged: boolean,
    extrasChanged: boolean,
  ) => ({
    clickToCallUrl: resolvedClickUrl,
    authHeaderName: settings.authHeaderName,
    callerId: settings.callerId?.trim() || null,
    isActive: settings.isActive,
    dialpadUrl: resolvedDialpadUrl,
    dialpadMode: settings.dialpadMode,
    callMethod: settings.callMethod,
    defaultDockState: settings.defaultDockState,
    theme: settings.theme,
    productionOrigin: settings.productionOrigin || null,
    duplicateGuardSeconds: settings.duplicateGuardSeconds,
    callsPerMinute: settings.callsPerMinute,
    maskNumbers: settings.maskNumbers,
    sendTenantIdInDial: settings.sendTenantIdInDial,
    blockDnc: settings.blockDnc,
    dncCount,
    dncNumbersChanged: dncChanged,
    hasKey: keySaved,
    keyChanged: Boolean(nextToken),
    extraHeaderNames: nextExtras.map((item) => item.name),
    extraHeadersChanged: extrasChanged,
  });
  const beforeAudit = existing ? {
    clickToCallUrl: publicClickToCallUrl(existing.clickToCallUrl),
    authHeaderName: existing.authHeaderName,
    callerId: existing.callerId,
    isActive: existing.isActive,
    dialpadUrl: existing.dialpadUrl,
    dialpadMode: existing.dialpadMode,
    callMethod: existing.callMethod,
    defaultDockState: existing.defaultDockState,
    theme: existing.theme,
    productionOrigin: existing.productionOrigin,
    duplicateGuardSeconds: existing.duplicateGuardSeconds,
    callsPerMinute: existing.callsPerMinute,
    maskNumbers: existing.maskNumbers,
    sendTenantIdInDial: existing.sendTenantIdInDial,
    blockDnc: existing.blockDnc,
    dncCount: existing.dncNumbers.split(/[\s,;]+/).filter(Boolean).length,
    dncNumbersChanged: false,
    hasKey: Boolean(existing.encryptedCredentials),
    keyChanged: false,
    extraHeaderNames: previousExtras.map((item) => item.name),
    extraHeadersChanged: false,
  } : null;
  const afterAudit = auditable(
    input,
    clickToCallUrl,
    dialpadUrl,
    Boolean(encryptedCredentials),
    dncNumbers.length,
    (existing?.dncNumbers || '').split(/[\s,;]+/).filter(Boolean).sort().join('\n') !== dncNumbers.slice().sort().join('\n'),
    JSON.stringify(previousExtras) !== JSON.stringify(nextExtras),
  );
  if (JSON.stringify(beforeAudit) !== JSON.stringify(afterAudit)) {
    await auditLog(tenantId, userId, 'TELEPHONY_SETTINGS_UPDATED', 'TelephonySetting', saved.id, beforeAudit || {}, afterAudit);
  }

  return publicTelephonySettings(saved);
}

export async function listTelephonyRequestLogs(tenantId: string) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.telephonyRequestLog.deleteMany({ where: { tenantId, createdAt: { lt: cutoff } } });
  return prisma.telephonyRequestLog.findMany({
    where: { tenantId, createdAt: { gte: cutoff } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      userId: true,
      leadId: true,
      maskedNumber: true,
      step: true,
      code: true,
      httpStatus: true,
      durationMs: true,
      reason: true,
      createdAt: true,
    },
  });
}

export { TelephonyCredentialError };
