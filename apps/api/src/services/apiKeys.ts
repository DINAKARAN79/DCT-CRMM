import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '@dct-crm/db';

const OBJECT_RESOURCES = [
  'leads',
  'follow-ups',
  'call-details',
  'site-visits',
  'bookings',
  'projects',
  'units',
  'enquiries',
  'activities',
  'quotations',
  'receipts',
  'records',
  'notes',
] as const;

export const DELETE_API_SCOPES = OBJECT_RESOURCES.map((resource) => `${resource}:delete`) as string[];

export const DEFAULT_COMPANY_API_SCOPES = OBJECT_RESOURCES.flatMap((resource) => [
  `${resource}:read`,
  `${resource}:write`,
]);

export const COMPANY_API_SCOPES = [
  ...DEFAULT_COMPANY_API_SCOPES,
  ...DELETE_API_SCOPES,
  'webhooks:manage',
] as const;

export type CompanyApiScope = typeof COMPANY_API_SCOPES[number];

const READ_GRANTED_BY: Record<string, string> = Object.fromEntries(
  OBJECT_RESOURCES.map((resource) => [`${resource}:read`, `${resource}:write`]),
);

const rateHits = new Map<string, number[]>();

export class ApiKeyAuthError extends Error {
  constructor(public status: number, message: string, public code = 'API_KEY_INVALID') {
    super(message);
    this.name = 'ApiKeyAuthError';
  }
}

export class ApiKeyEncryptionError extends Error {
  constructor(message = 'API key encryption is unavailable. Check API_KEY_ENCRYPTION_SECRET.') {
    super(message);
    this.name = 'ApiKeyEncryptionError';
  }
}

const API_KEY_ENCRYPTION_VERSION = 1;

function encryptionKey() {
  const encoded = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!encoded) throw new ApiKeyEncryptionError();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new ApiKeyEncryptionError('API_KEY_ENCRYPTION_SECRET must be a base64-encoded 32-byte value.');
  }
  return key;
}

function encryptApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encryptedKey = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return {
    encryptedKey: encryptedKey.toString('base64'),
    keyIv: iv.toString('base64'),
    keyTag: cipher.getAuthTag().toString('base64'),
    encryptionKeyVersion: API_KEY_ENCRYPTION_VERSION,
  };
}

export function decryptApiKey(record: {
  encryptedKey: string | null;
  keyIv: string | null;
  keyTag: string | null;
  encryptionKeyVersion: number;
}) {
  if (!record.encryptedKey || !record.keyIv || !record.keyTag) {
    throw new ApiKeyEncryptionError('This API key cannot be recovered. Generate a replacement key.');
  }
  if (record.encryptionKeyVersion !== API_KEY_ENCRYPTION_VERSION) {
    throw new ApiKeyEncryptionError('This API key uses an unsupported encryption-key version.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.keyIv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.keyTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.encryptedKey, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof ApiKeyEncryptionError) throw error;
    throw new ApiKeyEncryptionError('API key decryption failed. Verify API_KEY_ENCRYPTION_SECRET.');
  }
}

export function assertApiKeyEncryptionConfigured() {
  encryptionKey();
}

const KEY_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomToken(length: number) {
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length);
    for (const byte of bytes) {
      out += KEY_ALPHABET[byte % KEY_ALPHABET.length];
      if (out.length >= length) break;
    }
  }
  return out;
}

export function hashesEqual(storedHex: string, computedHex: string) {
  try {
    const stored = Buffer.from(storedHex, 'hex');
    const computed = Buffer.from(computedHex, 'hex');
    if (stored.length === 0 || stored.length !== computed.length) return false;
    return timingSafeEqual(stored, computed);
  } catch {
    return false;
  }
}

export function resetApiKeyRateLimits() {
  rateHits.clear();
}

export function resetApiKeyCache() {
  keyCache.clear();
  lastUsedWrite.clear();
}

export function hashApiKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKeySecret() {
  const publicId = randomToken(8);
  const secret = randomToken(40);
  const apiKey = `dct_live_${publicId}_${secret}`;
  return {
    apiKey,
    publicId,
    keyPrefix: `dct_live_${publicId}`,
    keyHash: hashApiKey(apiKey),
  };
}

export function apiKeyErrorBody(error: ApiKeyAuthError) {
  return { ok: false as const, code: error.code, message: error.message };
}

export function scopeAllows(granted: string[], required: string) {
  if (required.endsWith(':delete')) return granted.includes(required);
  if (granted.includes(required)) return true;
  const writer = READ_GRANTED_BY[required];
  return Boolean(writer && granted.includes(writer));
}

const RESOURCE_PREFIXES: Array<[string, string]> = [
  ['/api/records', 'records'],
  ['/api/quotations', 'quotations'],
  ['/api/receipts', 'receipts'],
  ['/api/notes', 'notes'],
  ['/api/call-details', 'call-details'],
  ['/api/follow-ups', 'follow-ups'],
  ['/api/site-visits', 'site-visits'],
  ['/api/bookings', 'bookings'],
  ['/api/projects', 'projects'],
  ['/api/units', 'units'],
  ['/api/enquiries', 'enquiries'],
  ['/api/activities', 'activities'],
  ['/api/leads', 'leads'],
];

export function requiredScopeForRequest(method: string, path: string): string | null {
  const pathname = path.split('?')[0];
  const resource = RESOURCE_PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
  if (!resource) return null;
  if (method === 'DELETE') return `${resource}:delete`;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return `${resource}:write`;
  if (method === 'GET' || method === 'HEAD') return `${resource}:read`;
  return null;
}

export function requestIp(req: Request) {
  return (req.ip || '').replace(/^::ffff:/, '');
}

export function consumeApiKeyRateLimit(keyId: string, limit: number, now = Date.now()) {
  const windowStart = now - 60_000;
  const recent = (rateHits.get(keyId) || []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= limit) {
    rateHits.set(keyId, recent);
    return false;
  }
  recent.push(now);
  rateHits.set(keyId, recent);
  return true;
}

export interface PresentedApiKey {
  apiKey: string;
  headerName: string;
}

const NON_API_KEY_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'dnt',
  'forwarded',
  'host',
  'origin',
  'pragma',
  'priority',
  'referer',
  'te',
  'upgrade',
  'user-agent',
  'via',
  'x-correlation-id',
  'x-csrf-token',
  'x-real-ip',
  'x-request-id',
  'x-requested-with',
  'x-session-auth',
  'x-xsrf-token',
]);

export function presentedApiKey(req: Request): PresentedApiKey | null {
  const candidates: PresentedApiKey[] = [];
  for (const [headerName, value] of Object.entries(req.headers)) {
    if (headerName === 'authorization') {
      const authorization = typeof value === 'string' ? value : value?.[0];
      if (authorization?.startsWith('Bearer ')) {
        const token = authorization.slice('Bearer '.length).trim();
        if (token.startsWith('dct_') || !/^[^.]+\.[^.]+\.[^.]+$/.test(token)) {
          candidates.push({ apiKey: token, headerName });
        }
      }
      continue;
    }
    if (headerName === 'x-api-key') {
      const token = typeof value === 'string' ? value : value?.[0];
      if (token?.trim()) candidates.push({ apiKey: token.trim(), headerName });
      continue;
    }
    if (
      NON_API_KEY_HEADER_NAMES.has(headerName)
      || headerName.startsWith('access-control-')
      || headerName.startsWith('proxy-')
      || headerName.startsWith('sec-')
      || headerName.startsWith('x-forwarded-')
    ) continue;
    const token = typeof value === 'string' ? value : value?.[0];
    if (!token?.trim()) continue;
    candidates.unshift({ apiKey: token.trim(), headerName });
  }
  return candidates[0] || null;
}

const KEY_CACHE_MS = 0;
const LAST_USED_THROTTLE_MS = 60_000;
const keyCache = new Map<string, { record: CachedApiKey; at: number }>();
const lastUsedWrite = new Map<string, number>();

type CachedApiKey = {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  customHeaderName: string | null;
  acceptOnlyCustomHeader: boolean;
  status: string;
  rateLimitPerMinute: number;
  ipAllowlist: string[];
  expiresAt: Date | null;
  graceUntil: Date | null;
  revokedAt: Date | null;
  createdById: string;
};

export function forgetApiKeyCache(record: { id?: string; keyPrefix?: string; keyHash?: string }) {
  if (record.keyPrefix) keyCache.delete(`prefix:${record.keyPrefix}`);
  if (record.keyHash) keyCache.delete(`hash:${record.keyHash}`);
  if (record.id) {
    for (const [key, value] of keyCache) {
      if (value.record.id === record.id) keyCache.delete(key);
    }
  }
}

export function publicApiKey(record: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  customHeaderName?: string | null;
  acceptOnlyCustomHeader?: boolean;
  status?: string;
  rateLimitPerMinute: number;
  ipAllowlist: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  graceUntil?: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  needsRegenerate?: boolean;
  revealedToCompanyAdminAt?: Date | null;
}) {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scopes: record.scopes,
    customHeaderName: record.customHeaderName || null,
    acceptOnlyCustomHeader: Boolean(record.acceptOnlyCustomHeader),
    status: record.revokedAt || record.status === 'revoked' ? 'revoked' : 'active',
    rateLimitPerMinute: record.rateLimitPerMinute,
    ipAllowlist: record.ipAllowlist,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    graceUntil: record.graceUntil || null,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    needsRegenerate: Boolean(record.needsRegenerate),
    revealedToCompanyAdminAt: record.revealedToCompanyAdminAt || null,
  };
}

export async function getCompanyApiKey(tenantId: string) {
  const [tenant, keys] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, companyCode: true } }),
    prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
  ]);
  if (!tenant) throw new ApiKeyAuthError(404, 'Company not found', 'COMPANY_NOT_FOUND');
  const current = keys.find((key) => !key.revokedAt && key.status !== 'revoked')
    || keys[0]
    || null;
  return {
    company: tenant,
    apiKey: current ? publicApiKey(current) : null,
  };
}

export async function revealCompanyApiKey(tenantId: string) {
  const metadata = await getCompanyApiKey(tenantId);
  if (!metadata.apiKey) throw new ApiKeyAuthError(404, 'No API key exists for this company.', 'API_KEY_NOT_FOUND');
  const record = await prisma.apiKey.findFirst({
    where: { id: metadata.apiKey.id, tenantId },
  });
  if (!record) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  return { record: metadata.apiKey, apiKey: decryptApiKey(record) };
}

export async function getSetupCompanyApiKey(tenantId: string) {
  const [tenant, keys] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, companyCode: true } }),
    prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
  ]);
  if (!tenant) throw new ApiKeyAuthError(404, 'Company not found', 'COMPANY_NOT_FOUND');
  const current = keys.find((key) => !key.revokedAt && key.status === 'active') || keys[0] || null;
  return {
    company: tenant,
    apiKey: current ? publicApiKey(current) : null,
    canRevealOnce: Boolean(
      current
      && !current.revokedAt
      && current.status === 'active'
      && current.encryptedKey
      && current.keyIv
      && current.keyTag
      && !current.revealedToCompanyAdminAt
    ),
  };
}

export async function revealSetupCompanyApiKey(tenantId: string, userId: string, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.apiKey.findFirst({
      where: { tenantId, status: 'active', revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      const latest = await tx.apiKey.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      if (latest) {
        throw new ApiKeyAuthError(410, 'This API key is no longer available. Ask a Super Admin to generate a replacement.', 'API_KEY_ALREADY_REVEALED');
      }
      throw new ApiKeyAuthError(404, 'No active API key exists for this company.', 'API_KEY_NOT_FOUND');
    }
    if (!current.encryptedKey || !current.keyIv || !current.keyTag) {
      throw new ApiKeyAuthError(409, 'This API key needs to be regenerated by a Super Admin.', 'API_KEY_NEEDS_REGENERATION');
    }
    const claim = await tx.apiKey.updateMany({
      where: {
        id: current.id,
        tenantId,
        status: 'active',
        revokedAt: null,
        revealedToCompanyAdminAt: null,
      },
      data: { revealedToCompanyAdminAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new ApiKeyAuthError(410, 'This API key has already been shown. Rotate it to get a new one-time view.', 'API_KEY_ALREADY_REVEALED');
    }
    const claimed = await tx.apiKey.findUnique({ where: { id: current.id } });
    if (!claimed) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
    const apiKey = decryptApiKey(claimed);
    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'API_KEY_REVEALED_ONCE',
        objectType: 'ApiKey',
        objectId: claimed.id,
        newValues: {
          companyId: tenantId,
          occurredAt: new Date().toISOString(),
        },
        ipAddress,
      },
    });
    return { record: publicApiKey(claimed), apiKey };
  });
}

type ApiKeyStore = Pick<Prisma.TransactionClient, 'apiKey'>;

export async function issueDefaultApiKey(db: ApiKeyStore, tenantId: string, createdById: string) {
  const secret = generateApiKeySecret();
  const record = await db.apiKey.create({
    data: {
      tenantId,
      name: 'Default key',
      keyPrefix: secret.keyPrefix,
      publicId: secret.publicId,
      keyHash: secret.keyHash,
      ...encryptApiKey(secret.apiKey),
      needsRegenerate: false,
      revealedToCompanyAdminAt: null,
      scopes: DEFAULT_COMPANY_API_SCOPES,
      status: 'active',
      rateLimitPerMinute: 120,
      ipAllowlist: [],
      expiresAt: null,
      createdById,
    },
  });
  return { record: publicApiKey(record), apiKey: secret.apiKey };
}

export async function generateCompanyApiKey(tenantId: string, createdById: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new ApiKeyAuthError(404, 'Company not found', 'COMPANY_NOT_FOUND');
  const existing = await prisma.apiKey.findMany({
    where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
    orderBy: { createdAt: 'desc' },
  });
  const current = existing[0];
  if (current && !current.needsRegenerate && current.encryptedKey && current.keyIv && current.keyTag) {
    throw new ApiKeyAuthError(409, 'This company already has a recoverable API key. Rotate it instead.', 'API_KEY_EXISTS');
  }
  const secret = generateApiKeySecret();
  const record = await prisma.$transaction(async (tx) => {
    await tx.apiKey.updateMany({
      where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
      data: { status: 'revoked', revokedAt: new Date(), graceUntil: null },
    });
    return tx.apiKey.create({
      data: {
        tenantId,
        name: existing[0]?.name || 'Default key',
        keyPrefix: secret.keyPrefix,
        publicId: secret.publicId,
        keyHash: secret.keyHash,
        ...encryptApiKey(secret.apiKey),
        needsRegenerate: false,
        revealedToCompanyAdminAt: null,
        scopes: existing[0]?.scopes?.length ? existing[0].scopes : DEFAULT_COMPANY_API_SCOPES,
        status: 'active',
        rateLimitPerMinute: existing[0]?.rateLimitPerMinute || 120,
        ipAllowlist: existing[0]?.ipAllowlist || [],
        expiresAt: null,
        customHeaderName: existing[0]?.customHeaderName || null,
        acceptOnlyCustomHeader: Boolean(existing[0]?.acceptOnlyCustomHeader),
        createdById,
      },
    });
  });
  for (const key of existing) forgetApiKeyCache(key);
  return { record: publicApiKey(record) };
}

export async function updateCompanyApiKeyScopes(tenantId: string, keyId: string, scopes: string[]) {
  const existing = await prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
  if (!existing) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  if (existing.revokedAt || existing.status === 'revoked') {
    throw new ApiKeyAuthError(409, 'Revoked API keys cannot be changed', 'API_KEY_REVOKED');
  }
  const record = await prisma.apiKey.update({ where: { id: existing.id }, data: { scopes } });
  forgetApiKeyCache(existing);
  return publicApiKey(record);
}

const RESERVED_CUSTOM_HEADER_NAMES = new Set([
  'authorization',
  'host',
  'content-type',
  'content-length',
  'cookie',
  'set-cookie',
]);

export function isValidCustomApiKeyHeaderName(value: string) {
  return /^[A-Za-z][A-Za-z0-9-]{1,60}$/.test(value)
    && !RESERVED_CUSTOM_HEADER_NAMES.has(value.toLowerCase())
    && !value.toLowerCase().startsWith('x-forwarded-')
    && !value.toLowerCase().startsWith('proxy-');
}

export async function updateCompanyApiKeyHeaderSettings(
  tenantId: string,
  keyId: string,
  customHeaderName: string | null,
  acceptOnlyCustomHeader: boolean,
) {
  if (customHeaderName !== null && !isValidCustomApiKeyHeaderName(customHeaderName)) {
    throw new ApiKeyAuthError(400, 'Custom header name is invalid or reserved.', 'INVALID_CUSTOM_HEADER');
  }
  if (acceptOnlyCustomHeader && !customHeaderName) {
    throw new ApiKeyAuthError(400, 'Set a custom header name before requiring it.', 'CUSTOM_HEADER_REQUIRED');
  }
  const existing = await prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
  if (!existing) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  if (existing.revokedAt || existing.status === 'revoked') {
    throw new ApiKeyAuthError(409, 'Revoked API keys cannot be changed', 'API_KEY_REVOKED');
  }
  const updated = await prisma.apiKey.update({
    where: { id: existing.id },
    data: { customHeaderName, acceptOnlyCustomHeader },
  });
  forgetApiKeyCache(existing);
  return publicApiKey(updated);
}

export async function revokeCompanyApiKey(tenantId: string, keyId: string) {
  const existing = await prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
  if (!existing) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  const activeKeys = await prisma.apiKey.findMany({
    where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
  });
  const record = existing.revokedAt
    ? existing
    : await prisma.$transaction(async (tx) => {
        await tx.apiKey.updateMany({
          where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
          data: { revokedAt: new Date(), status: 'revoked', graceUntil: null },
        });
        return tx.apiKey.findUniqueOrThrow({ where: { id: existing.id } });
      });
  for (const key of activeKeys) forgetApiKeyCache(key);
  forgetApiKeyCache(existing);
  return publicApiKey(record);
}

export async function rotateCompanyApiKey(
  tenantId: string,
  keyId: string,
  createdById: string,
) {
  const existing = await prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
  if (!existing) throw new ApiKeyAuthError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  const secret = generateApiKeySecret();
  const result = await prisma.$transaction(async (tx) => {
    const activeKeys = await tx.apiKey.findMany({
      where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
    });
    await tx.apiKey.updateMany({
      where: { tenantId, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
      data: { status: 'revoked', revokedAt: new Date(), graceUntil: null },
    });
    const record = await tx.apiKey.create({
      data: {
        tenantId,
        name: existing.name || 'Default key',
        keyPrefix: secret.keyPrefix,
        publicId: secret.publicId,
        keyHash: secret.keyHash,
        ...encryptApiKey(secret.apiKey),
        needsRegenerate: false,
        revealedToCompanyAdminAt: null,
        scopes: existing.scopes,
        status: 'active',
        rateLimitPerMinute: existing.rateLimitPerMinute,
        ipAllowlist: existing.ipAllowlist,
        expiresAt: existing.expiresAt,
        customHeaderName: existing.customHeaderName,
        acceptOnlyCustomHeader: existing.acceptOnlyCustomHeader,
        createdById,
      },
    });
    return { record, activeKeys };
  });
  for (const key of result.activeKeys) forgetApiKeyCache(key);
  forgetApiKeyCache(existing);
  return { record: publicApiKey(result.record), apiKey: secret.apiKey, previousId: existing.id };
}

export async function backfillPendingApiKeys() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let created = 0;
  for (const tenant of tenants) {
    const existing = await prisma.apiKey.findFirst({
      where: { tenantId: tenant.id, revokedAt: null, status: { in: ['active', 'pending_reveal', 'grace'] } },
      select: { id: true },
    });
    if (existing) continue;
    const placeholder = randomBytes(32).toString('hex');
    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'Default key',
        keyPrefix: `pending_${placeholder.slice(0, 12)}`,
        keyHash: hashApiKey(`pending:${tenant.id}:${placeholder}`),
        needsRegenerate: true,
        scopes: DEFAULT_COMPANY_API_SCOPES,
        status: 'pending_reveal',
        createdById: 'backfill',
      },
    });
    created += 1;
  }
  return { companies: tenants.length, created };
}

function liveKeyPrefix(rawKey: string) {
  const match = /^dct_live_([A-Za-z0-9]{8})_([A-Za-z0-9]{40,})$/.exec(rawKey);
  return match ? `dct_live_${match[1]}` : null;
}

async function loadApiKeyRecord(rawKey: string): Promise<CachedApiKey | null> {
  const prefix = liveKeyPrefix(rawKey);
  const cacheKey = prefix ? `prefix:${prefix}` : `hash:${hashApiKey(rawKey)}`;
  const cached = keyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < KEY_CACHE_MS) return cached.record;
  const record = prefix
    ? await prisma.apiKey.findFirst({ where: { keyPrefix: prefix } })
    : await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } });
  if (!record) return null;
  const cachedRecord: CachedApiKey = {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    keyPrefix: record.keyPrefix,
    keyHash: record.keyHash,
    scopes: record.scopes,
    customHeaderName: record.customHeaderName || null,
    acceptOnlyCustomHeader: Boolean(record.acceptOnlyCustomHeader),
    status: record.status || 'active',
    rateLimitPerMinute: record.rateLimitPerMinute,
    ipAllowlist: record.ipAllowlist,
    expiresAt: record.expiresAt,
    graceUntil: record.graceUntil || null,
    revokedAt: record.revokedAt,
    createdById: record.createdById,
  };
  keyCache.set(cacheKey, { record: cachedRecord, at: Date.now() });
  return cachedRecord;
}

function assertKeyUsable(record: CachedApiKey, computedHash: string) {
  const matches = hashesEqual(record.keyHash, computedHash);
  if (!matches) throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  if (record.status === 'pending_reveal') throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  if (record.status === 'revoked' || record.revokedAt) {
    throw new ApiKeyAuthError(401, 'API key has been revoked.', 'API_KEY_REVOKED');
  }
  if (record.status === 'grace') {
    if (!record.graceUntil || record.graceUntil.getTime() <= Date.now()) {
      throw new ApiKeyAuthError(401, 'API key has been revoked.', 'API_KEY_REVOKED');
    }
  }
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw new ApiKeyAuthError(401, 'API key has expired.', 'API_KEY_EXPIRED');
  }
}

export function rememberApiKeyUse(recordId: string) {
  const now = Date.now();
  const previous = lastUsedWrite.get(recordId) || 0;
  if (now - previous < LAST_USED_THROTTLE_MS) return;
  lastUsedWrite.set(recordId, now);
  void prisma.apiKey.update({ where: { id: recordId }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
}

export function logApiKeyRequest(input: {
  apiKeyId: string | null;
  tenantId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ipAddress: string | null;
}) {
  const path = input.path.split('?')[0].slice(0, 300);
  void prisma.apiKeyRequestLog.create({
    data: {
      apiKeyId: input.apiKeyId,
      tenantId: input.tenantId,
      method: input.method.slice(0, 16),
      path,
      status: input.status,
      durationMs: input.durationMs,
      ipAddress: input.ipAddress,
    },
  }).catch((error: unknown) => {
    console.error('Failed to write API key request audit log:', error);
  });
}

const loggedApiKeyResponses = new WeakSet<Response>();

export function attachApiKeyRequestLog(
  req: Request,
  res: Response,
  record?: { id: string; tenantId: string },
) {
  if (loggedApiKeyResponses.has(res)) return;
  loggedApiKeyResponses.add(res);
  const started = Date.now();
  res.on('finish', () => {
    logApiKeyRequest({
      apiKeyId: record?.id || null,
      tenantId: record?.tenantId || null,
      method: req.method,
      path: req.originalUrl || req.path || '',
      status: res.statusCode,
      durationMs: Date.now() - started,
      ipAddress: requestIp(req) || null,
    });
  });
}

function requestedTenantIds(req: Request): unknown[] {
  const hints: unknown[] = [];
  const queryTenant = req.query.tenantId;
  if (queryTenant !== undefined) {
    hints.push(...(Array.isArray(queryTenant) ? queryTenant : [queryTenant]));
  }
  const body = req.body as { tenantId?: unknown } | undefined;
  if (body && body.tenantId !== undefined) hints.push(body.tenantId);
  return hints;
}

export async function authenticatePresentedApiKey(req: Request, res: Response, rawKey: string, headerName: string) {
  const wellFormed = liveKeyPrefix(rawKey) || /^dct_[A-Za-z0-9_-]{16,}$/.test(rawKey);
  if (!wellFormed) throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  const computedHash = hashApiKey(rawKey);
  const record = await loadApiKeyRecord(rawKey);
  if (record) attachApiKeyRequestLog(req, res, record);
  if (!record) {
    hashesEqual(computedHash, computedHash);
    throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  }
  assertKeyUsable(record, computedHash);
  const isConfiguredCustomHeader = Boolean(record.customHeaderName && record.customHeaderName.toLowerCase() === headerName.toLowerCase());
  const isStandardHeader = headerName === 'authorization' || headerName === 'x-api-key';
  if (isStandardHeader && record.acceptOnlyCustomHeader && !isConfiguredCustomHeader) {
    throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  }
  if (!isStandardHeader && !isConfiguredCustomHeader) {
    throw new ApiKeyAuthError(401, 'API key is invalid.', 'API_KEY_INVALID');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: record.tenantId },
    select: { id: true, isActive: true, companyStartDate: true, companyExpiryDate: true },
  });
  if (!tenant || !tenant.isActive) {
    throw new ApiKeyAuthError(403, 'Company is inactive. Contact Super Admin.', 'COMPANY_INACTIVE');
  }
  const now = new Date();
  if (tenant.companyStartDate && now < tenant.companyStartDate) {
    throw new ApiKeyAuthError(403, 'Company is inactive. Contact Super Admin.', 'COMPANY_INACTIVE');
  }
  if (tenant.companyExpiryDate && now > tenant.companyExpiryDate) {
    throw new ApiKeyAuthError(403, 'Company is inactive. Contact Super Admin.', 'COMPANY_INACTIVE');
  }

  const tenantHints = requestedTenantIds(req);
  if (tenantHints.some((hint) => typeof hint !== 'string' || hint.trim() !== record.tenantId)) {
    throw new ApiKeyAuthError(403, 'tenantId does not match this API key', 'TENANT_MISMATCH');
  }

  if (record.ipAllowlist.length > 0 && !record.ipAllowlist.includes(requestIp(req))) {
    throw new ApiKeyAuthError(403, 'Request IP is not allowed for this API key', 'IP_NOT_ALLOWED');
  }

  const required = requiredScopeForRequest(req.method, req.originalUrl || req.url || '');
  if (!required) throw new ApiKeyAuthError(403, 'This API key cannot access this endpoint', 'INSUFFICIENT_SCOPE');
  if (!scopeAllows(record.scopes, required)) {
    throw new ApiKeyAuthError(403, `API key is missing the ${required} scope`, 'INSUFFICIENT_SCOPE');
  }

  if (!consumeApiKeyRateLimit(record.id, record.rateLimitPerMinute)) {
    const error = new ApiKeyAuthError(429, 'API key rate limit exceeded', 'RATE_LIMITED');
    throw error;
  }

  rememberApiKeyUse(record.id);

  return {
    record,
    user: {
      id: record.createdById,
      email: 'api-key',
      tenantId: record.tenantId,
      isSuperAdmin: false,
      isAdmin: true,
    },
  };
}
