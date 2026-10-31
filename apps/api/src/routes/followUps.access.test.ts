import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  id: 'user-a',
  isAdmin: false,
  isSuperAdmin: false,
}));

const viewState = vi.hoisted(() => ({
  where: null as Record<string, unknown> | null,
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    followUp: {
      findMany: database.findMany,
      findFirst: database.findFirst,
      count: database.count,
      update: database.update,
    },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, {
      user: {
        id: authState.id,
        tenantId: 'tenant-a',
        isAdmin: authState.isAdmin,
        isSuperAdmin: authState.isSuperAdmin,
      },
      tenantId: 'tenant-a',
    });
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../services/listViewService', () => ({
  listViewConstraint: vi.fn(async () => ({ ok: true, where: viewState.where })),
  listOrderBy: vi.fn(() => ({ ok: true, orderBy: null })),
  mergeListWhere: (where: { AND?: unknown[] }, extra: Record<string, unknown> | null) => {
    if (!extra || Object.keys(extra).length === 0) return where;
    where.AND = [...(where.AND || []), extra];
    return where;
  },
}));

vi.mock('../services/leadWorkflowExtras', () => ({
  normalizeOverdueFollowUps: vi.fn(),
  promoteNewLeadOnFirstActivity: vi.fn(),
}));

vi.mock('../services/leadEventTagging', () => ({
  tagLeadFollowUpEvents: vi.fn(),
}));

vi.mock('../services/leadNotes', () => ({
  appendLeadProcessNote: vi.fn(),
}));

vi.mock('../services/recordAccess', () => ({
  canAccessLeadId: vi.fn(),
}));

import { followUpRoutes } from './followUps';

const servers: Server[] = [];

async function request(path: string, method: 'GET' | 'PUT' = 'GET') {
  const app = express();
  app.use(express.json());
  app.use('/api/follow-ups', followUpRoutes);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.id = 'user-a';
  authState.isAdmin = false;
  authState.isSuperAdmin = false;
  viewState.where = null;
  database.findMany.mockResolvedValue([]);
  database.findFirst.mockResolvedValue(null);
  database.count.mockResolvedValue(0);
});

afterEach(() => {
  servers.splice(0).forEach((server) => server.close());
});

describe('follow-up access', () => {
  it('returns only the owner rows, and the total uses the same filter', async () => {
    const response = await request('/api/follow-ups?status=SCHEDULED');
    const body = await response.json() as { pagination: { total: number } };
    const where = {
      AND: [
        { tenantId: 'tenant-a', ownerId: 'user-a' },
        { isCompleted: false, isMissed: false, status: { not: 'CANCELLED' } },
      ],
    };

    expect(response.status).toBe(200);
    expect(body.pagination.total).toBe(0);
    expect(database.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(database.count).toHaveBeenCalledWith({ where });
  });

  it('keeps the owner filter when search, status, and a list view are applied', async () => {
    viewState.where = { title: { contains: 'view preset' } };
    const response = await request('/api/follow-ups?search=F-000032&status=MISSED&ownerId=someone-else');

    expect(response.status).toBe(200);
    expect(database.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { tenantId: 'tenant-a', ownerId: 'user-a' },
          expect.objectContaining({
            isMissed: true,
            ownerId: 'someone-else',
            OR: expect.arrayContaining([
              { followUpNumber: { contains: 'F-000032', mode: 'insensitive' } },
            ]),
          }),
          { title: { contains: 'view preset' } },
        ],
      },
    }));
    expect(database.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ tenantId: 'tenant-a', ownerId: 'user-a' }]),
      }),
    });
  });

  it('lets an admin list every follow-up in the tenant', async () => {
    authState.isAdmin = true;
    const response = await request('/api/follow-ups');

    expect(response.status).toBe(200);
    expect(database.count).toHaveBeenCalledWith({
      where: { AND: [{ tenantId: 'tenant-a' }, {}] },
    });
  });

  it('returns 404 for a direct link the user does not own', async () => {
    const response = await request('/api/follow-ups/follow-up-b');
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Follow-up not found');
    expect(database.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'follow-up-b', tenantId: 'tenant-a', ownerId: 'user-a' },
    }));
    expect(database.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the previous owner opens a follow-up after it is reassigned', async () => {
    const response = await request('/api/follow-ups/follow-up-b', 'PUT');

    expect(response.status).toBe(404);
    expect(database.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'follow-up-b', tenantId: 'tenant-a', ownerId: 'user-a' },
    }));
    expect(database.update).not.toHaveBeenCalled();
  });
});
