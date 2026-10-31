import { createHash } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'require-api-key-secret';

const database = vi.hoisted(() => ({
  apiKeyFindFirst: vi.fn(),
  apiKeyFindUnique: vi.fn(),
  apiKeyUpdate: vi.fn(),
  requestLogCreate: vi.fn(),
  tenantFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    apiKey: {
      findFirst: database.apiKeyFindFirst,
      findUnique: database.apiKeyFindUnique,
      update: database.apiKeyUpdate,
    },
    apiKeyRequestLog: { create: database.requestLogCreate },
    tenant: { findUnique: database.tenantFindUnique },
    user: { findUnique: database.userFindUnique },
  },
}));

import { EXTERNAL_API_MOUNTS, requireApiKey } from './requireApiKey';
import type { AuthRequest } from './auth';
import { generateApiKeySecret, hashApiKey, isValidCustomApiKeyHeaderName, resetApiKeyCache, resetApiKeyRateLimits } from '../services/apiKeys';

const servers: Server[] = [];
const routes = EXTERNAL_API_MOUNTS.map(({ path }) => path);

function listen(app: express.Express) {
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return address.port;
}

function keyRecord(secret: ReturnType<typeof generateApiKeySecret>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    tenantId: 'tenant-a',
    name: 'Default key',
    keyPrefix: secret.keyPrefix,
    publicId: secret.publicId,
    keyHash: secret.keyHash,
    scopes: ['leads:read', 'leads:write'],
    status: 'active',
    rateLimitPerMinute: 120,
    ipAllowlist: [],
    expiresAt: null,
    graceUntil: null,
    revokedAt: null,
    createdById: 'admin-a',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetApiKeyRateLimits();
  resetApiKeyCache();
  database.apiKeyUpdate.mockResolvedValue({});
  database.requestLogCreate.mockResolvedValue({});
  database.tenantFindUnique.mockResolvedValue({
    id: 'tenant-a',
    isActive: true,
    companyStartDate: null,
    companyExpiryDate: null,
  });
  database.userFindUnique.mockResolvedValue({
    id: 'user-a',
    email: 'admin@example.com',
    tenantId: 'tenant-a',
    isActive: true,
    isSuperAdmin: false,
    profileId: 'profile-a',
    profile: { id: 'profile-a', name: 'Admin', isAdmin: true },
    tenant: { isActive: true, companyStartDate: null, companyExpiryDate: null },
  });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('mandatory company API keys', () => {
  it('rejects a missing, wrong, revoked, or expired key on every external object route', async () => {
    const secret = generateApiKeySecret();
    const app = express();
    for (const path of routes) {
      app.use(path, requireApiKey, (_req, res) => res.json({ ok: true }));
    }
    const port = listen(app);

    for (const path of routes) {
      database.apiKeyFindFirst.mockResolvedValue(null);
      const missing = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(missing.status).toBe(401);
      expect(await missing.json()).toMatchObject({ ok: false, code: 'API_KEY_MISSING' });
      expect(database.requestLogCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ apiKeyId: null, tenantId: null, method: 'GET', status: 401 }),
      }));

      const wrong = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { Authorization: `Bearer ${generateApiKeySecret().apiKey}` },
      });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toMatchObject({ ok: false, code: 'API_KEY_INVALID', message: 'API key is invalid.' });

      resetApiKeyCache();
      database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { revokedAt: new Date(), status: 'revoked' }));
      const revoked = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { 'x-api-key': secret.apiKey },
      });
      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toMatchObject({ ok: false, code: 'API_KEY_REVOKED' });

      resetApiKeyCache();
      database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { expiresAt: new Date(Date.now() - 1000) }));
      const expired = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { 'x-api-key': secret.apiKey },
      });
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({ ok: false, code: 'API_KEY_EXPIRED' });
      resetApiKeyCache();
    }
  });

  it('requires a valid key for every method on each registered object route', async () => {
    const secret = generateApiKeySecret();
    const unknownSecret = generateApiKeySecret();
    const scopes = EXTERNAL_API_MOUNTS.flatMap(({ resource }) => [
      `${resource}:read`,
      `${resource}:write`,
      `${resource}:delete`,
    ]);
    const app = express();
    for (const { path } of EXTERNAL_API_MOUNTS) {
      app.use(path, requireApiKey, (_req, res) => res.json({ ok: true }));
    }
    const port = listen(app);

    for (const { path } of EXTERNAL_API_MOUNTS) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
        const missing = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        expect(missing.status).toBe(401);

        database.apiKeyFindFirst.mockResolvedValue(null);
        const wrong = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'x-api-key': unknownSecret.apiKey },
        });
        expect(wrong.status).toBe(401);
        expect(await wrong.json()).toMatchObject({ ok: false, code: 'API_KEY_INVALID' });

        resetApiKeyCache();
        database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { status: 'revoked', revokedAt: new Date() }));
        const revoked = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'x-api-key': secret.apiKey },
        });
        expect(revoked.status).toBe(401);
        expect(await revoked.json()).toMatchObject({ ok: false, code: 'API_KEY_REVOKED' });

        resetApiKeyCache();
        database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { expiresAt: new Date(Date.now() - 1000) }));
        const expired = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'x-api-key': secret.apiKey },
        });
        expect(expired.status).toBe(401);
        expect(await expired.json()).toMatchObject({ ok: false, code: 'API_KEY_EXPIRED' });

        resetApiKeyCache();
        database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes }));
        const authorized = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'x-api-key': secret.apiKey },
        });
        expect(authorized.status).toBe(200);
      }
    }
  });

  it('takes the company from the key and rejects a mismatched tenantId', async () => {
    const secret = generateApiKeySecret();
    let calls = 0;
    const app = express();
    app.use(express.json());
    app.use('/api/leads', requireApiKey, (req: AuthRequest, res) => {
      calls += 1;
      res.json({ tenantId: req.tenantId });
    });

    {
      const secret = generateApiKeySecret();
      const app = express();
      app.get('/api/leads', requireApiKey, (_req, res) => res.json({ ok: true }));
      const port = listen(app);
      database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, {
        customHeaderName: 'X-Company-Token',
        scopes: ['leads:read'],
      }));

      const customHeader = await fetch(`http://127.0.0.1:${port}/api/leads`, {
        headers: { 'X-Company-Token': secret.apiKey },
      });
      expect(customHeader.status).toBe(200);

      resetApiKeyCache();
      database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, {
        customHeaderName: 'X-Company-Token',
        acceptOnlyCustomHeader: true,
        scopes: ['leads:read'],
      }));
      const standardHeader = await fetch(`http://127.0.0.1:${port}/api/leads`, {
        headers: { 'x-api-key': secret.apiKey },
      });
      expect(standardHeader.status).toBe(401);
      expect(await standardHeader.json()).toMatchObject({ ok: false, code: 'API_KEY_INVALID' });

      const wrongCustomHeader = await fetch(`http://127.0.0.1:${port}/api/leads`, {
        headers: { 'X-Company-Token': 'not-the-company-key' },
      });
      expect(wrongCustomHeader.status).toBe(401);
      expect(await wrongCustomHeader.json()).toMatchObject({ ok: false, code: 'API_KEY_INVALID' });

      const requiredCustomHeader = await fetch(`http://127.0.0.1:${port}/api/leads`, {
        headers: { 'X-Company-Token': secret.apiKey },
      });
      expect(requiredCustomHeader.status).toBe(200);
    }

    {
      expect(isValidCustomApiKeyHeaderName('X-Company-Token')).toBe(true);
      for (const headerName of ['Authorization', 'Host', 'Content-Type', 'Content-Length', 'Cookie', 'Set-Cookie', 'X-Forwarded-Host', 'Proxy-Authorization']) {
        expect(isValidCustomApiKeyHeaderName(headerName)).toBe(false);
      }
      expect(isValidCustomApiKeyHeaderName('1Bad')).toBe(false);
      expect(isValidCustomApiKeyHeaderName('X')).toBe(false);
    }
    const port = listen(app);
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes: ['leads:read', 'leads:write', 'leads:delete'] }));

    const mismatch = await fetch(`http://127.0.0.1:${port}/api/leads?tenantId=tenant-b`, {
      headers: { Authorization: `Bearer ${secret.apiKey}` },
    });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
    expect(calls).toBe(0);

    const bodyMismatch = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-b' }),
    });
    expect(bodyMismatch.status).toBe(403);
    expect(calls).toBe(0);

    const allowed = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      headers: { Authorization: `Bearer ${secret.apiKey}` },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ tenantId: 'tenant-a' });
  });

  it('requires a separate delete scope, blocks an inactive company, and rate limits', async () => {
    const secret = generateApiKeySecret();
    const app = express();
    app.delete('/api/leads/:id', requireApiKey, (_req, res) => res.json({ deleted: true }));
    app.get('/api/leads', requireApiKey, (_req, res) => res.json({ ok: true }));
    const port = listen(app);
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret));

    const denied = await fetch(`http://127.0.0.1:${port}/api/leads/lead-1`, {
      method: 'DELETE',
      headers: { 'x-api-key': secret.apiKey },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, code: 'INSUFFICIENT_SCOPE', message: expect.stringContaining('leads:delete') });

    resetApiKeyCache();
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes: ['leads:delete'] }));
    const allowed = await fetch(`http://127.0.0.1:${port}/api/leads/lead-1`, {
      method: 'DELETE',
      headers: { 'x-api-key': secret.apiKey },
    });
    expect(allowed.status).toBe(200);

    resetApiKeyCache();
    resetApiKeyRateLimits();
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes: ['leads:read'] }));
    database.tenantFindUnique.mockResolvedValue({ id: 'tenant-a', isActive: false, companyStartDate: null, companyExpiryDate: null });
    const inactive = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      headers: { 'x-api-key': secret.apiKey },
    });
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toMatchObject({ code: 'COMPANY_INACTIVE' });

    resetApiKeyCache();
    database.tenantFindUnique.mockResolvedValue({ id: 'tenant-a', isActive: true, companyStartDate: null, companyExpiryDate: null });
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes: ['leads:read'], rateLimitPerMinute: 1 }));
    const first = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } });
    const second = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('60');
  });

  it('stops a rotated key after its grace period and a revoked key after the cache is cleared', async () => {
    const secret = generateApiKeySecret();
    const app = express();
    app.get('/api/leads', requireApiKey, (_req, res) => res.json({ ok: true }));
    const port = listen(app);
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, {
      status: 'grace',
      graceUntil: new Date(Date.now() + 60_000),
      scopes: ['leads:read'],
    }));
    const duringGrace = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } });
    expect(duringGrace.status).toBe(200);

    resetApiKeyCache();
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, {
      status: 'grace',
      graceUntil: new Date(Date.now() - 1000),
      scopes: ['leads:read'],
    }));
    const afterGrace = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } });
    expect(afterGrace.status).toBe(401);
    expect(await afterGrace.json()).toMatchObject({ code: 'API_KEY_REVOKED' });

    resetApiKeyCache();
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { scopes: ['leads:read'] }));
    expect((await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } })).status).toBe(200);
    database.apiKeyFindFirst.mockResolvedValue(keyRecord(secret, { status: 'revoked', revokedAt: new Date(), scopes: ['leads:read'] }));
    resetApiKeyCache();
    const revoked = await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { 'x-api-key': secret.apiKey } });
    expect(revoked.status).toBe(401);
  });

  it('still accepts a browser JWT on the same route', async () => {
    const app = express();
    app.get('/api/leads', requireApiKey, (req: AuthRequest, res) => res.json({ tenantId: req.tenantId, apiKey: Boolean(req.apiKey) }));
    const port = listen(app);
    const token = jwt.sign({ id: 'user-a', email: 'admin@example.com', tenantId: 'tenant-a', isSuperAdmin: false }, process.env.JWT_SECRET!);
    const response = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      headers: { Authorization: `Bearer ${token}`, 'x-session-auth': 'required' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: 'tenant-a', apiKey: false });
  });

  it('fails the registry check when an external route is mounted without the API key middleware', () => {
    const index = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    for (const { path } of EXTERNAL_API_MOUNTS) {
      expect(index).toContain(`mountExternalApi(app, '${path}'`);
      expect(index).not.toContain(`app.use('${path}'`);
    }
    expect(index).toContain("app.get('/api/health'");
    expect(index).not.toContain("app.get('/health'");
    expect(index).not.toContain("app.get('/',");
    expect(index).not.toContain('OPEN_API_DEV_MODE');
  });

  it('rejects API keys supplied in query parameters or request bodies', async () => {
    const app = express();
    app.use(express.json());
    app.all('/api/leads', requireApiKey, (_req, res) => res.json({ ok: true }));
    const port = listen(app);
    for (const url of ['/api/leads?api_key=dct_live_12345678_invalid', '/api/leads?apiKey=secret']) {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 'secret' }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false, code: 'API_KEY_INVALID' });
    }
  });
});

describe('key material', () => {
  it('stores a hash and never returns the raw secret from the public record', () => {
    const secret = generateApiKeySecret();
    expect(secret.apiKey.startsWith(`${secret.keyPrefix}_`)).toBe(true);
    expect(secret.keyHash).toBe(hashApiKey(secret.apiKey));
    expect(secret.keyHash).not.toContain(secret.apiKey);
    expect(createHash('sha256').update(secret.apiKey).digest('hex')).toHaveLength(64);
  });
});
