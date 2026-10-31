import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'impersonation-test-secret';

const passwordHash = bcrypt.hashSync('password123', 4);

const database = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  tenantFindUnique: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionCount: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  notificationCreateMany: vi.fn(),
}));

vi.mock('@dct-crm/db', () => {
  const prisma = {
    user: {
      findUnique: database.userFindUnique,
      findMany: database.userFindMany,
      findFirst: database.userFindFirst,
      update: vi.fn(async () => ({})),
    },
    userSession: {
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    tenant: { findUnique: database.tenantFindUnique },
    impersonationSession: {
      findUnique: database.sessionFindUnique,
      findFirst: database.sessionFindFirst,
      findMany: database.sessionFindMany,
      count: database.sessionCount,
      create: database.sessionCreate,
      update: database.sessionUpdate,
      updateMany: database.sessionUpdateMany,
    },
    tenantImpersonationSetting: {
      findUnique: database.settingFindUnique,
      upsert: database.settingUpsert,
    },
    auditLog: { create: database.auditCreate },
    notification: { createMany: database.notificationCreateMany },
  } as Record<string, unknown>;
  prisma.$transaction = async (fn: (client: typeof prisma) => Promise<unknown>) => fn(prisma);
  return { prisma };
});

import { authenticate, generateToken } from '../middleware/auth';
import { companyImpersonationRouter } from './impersonation';

const servers: Server[] = [];
const superadminRecord = {
  id: 'super-a',
  email: 'super@example.com',
  tenantId: 'platform',
  isActive: true,
  isSuperAdmin: true,
  profileId: null,
  profile: null,
  tenant: { isActive: true, companyStartDate: null, companyExpiryDate: null },
};
const adminRecord = {
  id: 'admin-a',
  email: 'admin@tenant.test',
  tenantId: 'tenant-a',
  isActive: true,
  isSuperAdmin: false,
  profileId: 'profile-admin',
  profile: { id: 'profile-admin', name: 'System Administrator', isAdmin: true },
  tenant: { isActive: true, companyStartDate: null, companyExpiryDate: null },
};
const memberRecord = {
  ...adminRecord,
  id: 'member-a',
  email: 'member@tenant.test',
  profile: { id: 'profile-sales', name: 'Sales', isAdmin: false },
};

function listen(app: express.Express) {
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return address.port;
}

function superToken(loginAt: number | null = Date.now()) {
  return generateToken({
    id: 'super-a',
    email: 'super@example.com',
    tenantId: 'platform',
    isSuperAdmin: true,
    ...(loginAt == null ? {} : { loginAt }),
  });
}

function memberToken() {
  return generateToken({
    id: 'member-a',
    email: 'member@tenant.test',
    tenantId: 'tenant-a',
    isSuperAdmin: false,
    loginAt: Date.now(),
  });
}

function impersonationToken() {
  return generateToken({
    id: 'admin-a',
    email: 'admin@tenant.test',
    tenantId: 'tenant-a',
    isSuperAdmin: false,
    impersonatedBy: 'super-a',
    isImpersonation: true,
    impersonationId: 'session-1',
    loginAt: Date.now(),
  }, '60m');
}

let session: any;

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    id: 'session-1',
    superadminId: 'super-a',
    tenantId: 'tenant-a',
    actingAsUserId: 'admin-a',
    endedAt: null,
    viewOnly: false,
    allowInactive: false,
    hardExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    returnPath: '/admin/companies/tenant-a',
    superadminLoginAt: new Date(Date.now() - 60_000),
  };
  database.userFindUnique.mockImplementation(async ({ where, select }: any) => {
    if (where.id === 'super-a') {
      if (select?.passwordHash) return { passwordHash, isActive: true, isSuperAdmin: true };
      if (select?.isActive && !select?.email) return { isActive: true, isSuperAdmin: true };
      if (select?.firstName && !select?.tenantId) return { firstName: 'Super', lastName: 'Admin', email: 'super@example.com' };
      return superadminRecord;
    }
    if (where.id === 'admin-a') return adminRecord;
    if (where.id === 'member-a') return memberRecord;
    return null;
  });
  database.userFindMany.mockResolvedValue([{
    id: 'admin-a',
    email: 'admin@tenant.test',
    firstName: 'System',
    lastName: 'Administrator',
    profile: { name: 'System Administrator' },
  }]);
  database.userFindFirst.mockResolvedValue({
    id: 'admin-a',
    email: 'admin@tenant.test',
    tenantId: 'tenant-a',
    isSuperAdmin: false,
  });
  database.tenantFindUnique.mockImplementation(async ({ where }: any) => ({
    id: where.id,
    name: 'DCT Real Estate',
    isActive: where.id !== 'inactive',
    companyStartDate: null,
    companyExpiryDate: null,
  }));
  database.sessionFindUnique.mockImplementation(async () => session);
  database.sessionCount.mockResolvedValue(0);
  database.sessionCreate.mockImplementation(async ({ data }: any) => ({
    id: 'session-1',
    ...data,
    hardExpiresAt: data.hardExpiresAt,
  }));
  database.sessionUpdate.mockResolvedValue({});
  database.sessionUpdateMany.mockResolvedValue({ count: 1 });
  database.sessionFindFirst.mockResolvedValue(null);
  database.auditCreate.mockResolvedValue({});
  database.settingFindUnique.mockResolvedValue(null);
  database.notificationCreateMany.mockResolvedValue({ count: 1 });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('impersonation session', () => {
  function sessionApp() {
    const app = express();
    app.use(express.json());
    const leads: Record<string, Record<string, { name: string }>> = {
      'shared-id': {
        'tenant-a': { name: 'Tenant A lead' },
        'tenant-b': { name: 'Tenant B lead' },
      },
    };
    app.get('/api/leads/:id', authenticate, (req: any, res) => {
      res.json({
        tenantId: req.tenantId,
        super: req.user.isSuperAdmin,
        data: leads[String(req.params.id)]?.[String(req.tenantId)] || null,
      });
    });
    app.post('/api/leads', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/api/data-administration/import', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/api/users/:id/password', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/api/impersonation/exit', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/api/setup/users/:id/impersonate', authenticate, (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('keeps the company from the session when record ids overlap', async () => {
    const port = listen(sessionApp());
    const headers = { Authorization: `Bearer ${impersonationToken()}` };
    const own = await fetch(`http://127.0.0.1:${port}/api/leads/shared-id`, { headers });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ tenantId: 'tenant-a', super: false, data: { name: 'Tenant A lead' } });

    const other = await fetch(`http://127.0.0.1:${port}/api/leads/shared-id?tenantId=tenant-b`, { headers });
    expect(other.status).toBe(403);
  });

  it('rejects an ended or expired session immediately', async () => {
    const port = listen(sessionApp());
    const headers = { Authorization: `Bearer ${impersonationToken()}` };
    session.endedAt = new Date();
    const ended = await fetch(`http://127.0.0.1:${port}/api/leads/shared-id`, { headers });
    expect(ended.status).toBe(401);

    session.endedAt = null;
    session.hardExpiresAt = new Date(Date.now() - 1000);
    const expired = await fetch(`http://127.0.0.1:${port}/api/leads/shared-id`, { headers });
    expect(expired.status).toBe(401);
    expect(database.sessionUpdateMany).toHaveBeenCalled();
  });

  it('blocks view-only writes, including import, and blocks secrets and a second impersonation', async () => {
    session.viewOnly = true;
    const port = listen(sessionApp());
    const headers = { Authorization: `Bearer ${impersonationToken()}`, 'Content-Type': 'application/json' };
    expect((await fetch(`http://127.0.0.1:${port}/api/leads/shared-id`, { headers })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/leads`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/api/data-administration/import`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    const exit = await fetch(`http://127.0.0.1:${port}/api/impersonation/exit`, { method: 'POST', headers });
    expect(exit.status).toBe(200);

    session.viewOnly = false;
    const password = await fetch(`http://127.0.0.1:${port}/api/users/admin-a/password`, { method: 'POST', headers, body: '{}' });
    expect(password.status).toBe(403);
    const nested = await fetch(`http://127.0.0.1:${port}/api/setup/users/member-a/impersonate`, { method: 'POST', headers, body: '{}' });
    expect(nested.status).toBe(403);
  });
});

describe('start impersonation', () => {
  function routeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/companies/:tenantId', companyImpersonationRouter);
    return app;
  }

  it('rejects a tenant user and a tenant admin', async () => {
    const port = listen(routeApp());
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken()}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(database.sessionCreate).not.toHaveBeenCalled();
  });

  it('requires the superadmin password when the session is older than 15 minutes', async () => {
    const port = listen(routeApp());
    const headers = { Authorization: `Bearer ${superToken(null)}`, 'Content-Type': 'application/json' };
    const missing = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST', headers, body: JSON.stringify({ viewOnly: false }),
    });
    expect(missing.status).toBe(403);
    expect((await missing.json() as { code: string }).code).toBe('reauth_required');

    const wrong = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST', headers, body: JSON.stringify({ password: 'nope' }),
    });
    expect(wrong.status).toBe(403);

    const opened = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST', headers, body: JSON.stringify({ password: 'password123' }),
    });
    expect(opened.status).toBe(201);
    expect(database.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'IMPERSONATION_STARTED', impersonatedById: 'super-a', userId: 'admin-a' }),
    }));
  });

  it('asks for an admin, blocks a company with none, and requires an override when inactive', async () => {
    const port = listen(routeApp());
    const headers = { Authorization: `Bearer ${superToken()}`, 'Content-Type': 'application/json' };
    database.userFindMany.mockResolvedValueOnce([
      { id: 'admin-a', email: 'a@tenant.test', firstName: 'System', lastName: 'Administrator', profile: { name: 'System Administrator' } },
      { id: 'admin-b', email: 'b@tenant.test', firstName: 'Other', lastName: 'Admin', profile: { name: 'Admin' } },
    ]);
    const choose = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST', headers, body: '{}',
    });
    expect(choose.status).toBe(409);
    expect((await choose.json() as { code: string }).code).toBe('choose_admin');

    database.userFindMany.mockResolvedValueOnce([]);
    const none = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST', headers, body: '{}',
    });
    expect(none.status).toBe(409);
    expect((await none.json() as { code: string }).code).toBe('no_admin');

    const blocked = await fetch(`http://127.0.0.1:${port}/api/admin/companies/inactive/impersonate`, {
      method: 'POST', headers, body: '{}',
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as { code: string }).code).toBe('company_inactive');

    const override = await fetch(`http://127.0.0.1:${port}/api/admin/companies/inactive/impersonate`, {
      method: 'POST', headers, body: JSON.stringify({ confirmInactive: true }),
    });
    expect(override.status).toBe(201);
    expect(database.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allowInactive: true, tenantId: 'inactive' }),
    }));
  });

  it('stops at three open sessions', async () => {
    database.sessionCount.mockResolvedValue(3);
    const port = listen(routeApp());
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/companies/tenant-a/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken()}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(429);
  });
});
