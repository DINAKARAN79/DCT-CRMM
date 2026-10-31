import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  apiKeyFindUnique: vi.fn(),
  apiKeyFindFirst: vi.fn(),
  apiKeyRequestLogCreate: vi.fn(),
  apiKeyUpdate: vi.fn(),
  tenantFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    apiKey: {
      findUnique: database.apiKeyFindUnique,
      findFirst: database.apiKeyFindFirst,
      update: database.apiKeyUpdate,
    },
    apiKeyRequestLog: { create: database.apiKeyRequestLogCreate },
    tenant: { findUnique: database.tenantFindUnique },
    user: { findUnique: database.userFindUnique },
  },
}));

import { requireApiKey } from './requireApiKey';
import type { AuthRequest } from './auth';
import { hashApiKey, resetApiKeyCache, resetApiKeyRateLimits } from '../services/apiKeys';

const servers: Server[] = [];

function listen(app: express.Express) {
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return address.port;
}

const rawKey = 'dct_testkeyvalue1234567890';

beforeEach(() => {
  vi.clearAllMocks();
  resetApiKeyRateLimits();
  database.apiKeyFindUnique.mockResolvedValue({
    id: 'key-1',
    tenantId: 'tenant-a',
    name: 'Website',
    keyPrefix: 'dct_testkey',
    keyHash: hashApiKey(rawKey),
    scopes: ['leads:read'],
    rateLimitPerMinute: 1,
    ipAllowlist: ['10.0.0.8'],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdById: 'super-a',
  });
  database.apiKeyFindFirst.mockResolvedValue({
    id: 'key-1',
    tenantId: 'tenant-a',
    name: 'Website',
    keyPrefix: 'dct_testkey',
    keyHash: hashApiKey(rawKey),
    scopes: ['leads:read'],
    status: 'active',
    rateLimitPerMinute: 1,
    ipAllowlist: ['10.0.0.8'],
    lastUsedAt: null,
    expiresAt: null,
    graceUntil: null,
    revokedAt: null,
    createdById: 'super-a',
  });
  database.tenantFindUnique.mockResolvedValue({
    id: 'tenant-a',
    isActive: true,
    companyStartDate: null,
    companyExpiryDate: null,
  });
  database.userFindUnique.mockResolvedValue({ id: 'super-a', email: 'super@example.com', isActive: true });
  database.apiKeyUpdate.mockResolvedValue({});
  database.apiKeyRequestLogCreate.mockResolvedValue({});
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('API key authentication', () => {
  it('uses the key company and rejects another tenant, a blocked IP, another endpoint, a missing scope, and the rate limit', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.get('/api/leads', requireApiKey, (req: AuthRequest, res) => {
      res.json({ tenantId: req.tenantId, keyId: req.apiKey?.id, super: req.user?.isSuperAdmin ?? false });
    });
    app.get('/api/projects', requireApiKey, (_req, res) => res.json({ ok: true }));
    const port = listen(app);
    const headers = { 'x-api-key': rawKey, 'x-forwarded-for': '10.0.0.8' };

    const allowed = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ tenantId: 'tenant-a', keyId: 'key-1', super: false });

    const mismatch = await fetch(`http://127.0.0.1:${port}/api/leads?tenantId=tenant-b`, {
      headers: { Authorization: `Bearer ${rawKey}`, 'x-forwarded-for': '10.0.0.8' },
    });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });

    const wrongIp = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      headers: { 'x-api-key': rawKey, 'x-forwarded-for': '10.9.9.9' },
    });
    expect(wrongIp.status).toBe(403);

    const blocked = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers });
    expect(blocked.status).toBe(403);

    resetApiKeyCache();
    database.apiKeyFindUnique.mockResolvedValueOnce({
      id: 'key-2',
      tenantId: 'tenant-b',
      keyHash: hashApiKey(rawKey),
      scopes: ['follow-ups:read'],
      status: 'active',
      rateLimitPerMinute: 120,
      ipAllowlist: [],
      expiresAt: null,
      graceUntil: null,
      revokedAt: null,
      createdById: 'super-a',
    });
    const otherCompany = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': rawKey } });
    const otherBody = await otherCompany.json() as { message: string };
    expect(otherCompany.status).toBe(403);
    expect(otherBody.message).toMatch(/missing the leads:read scope/);

    resetApiKeyCache();
    const limited = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers });
    expect(limited.status).toBe(429);
  });
});
