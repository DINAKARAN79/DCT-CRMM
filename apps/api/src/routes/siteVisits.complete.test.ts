import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  siteVisitFindFirst: vi.fn(),
  siteVisitUpdateMany: vi.fn(),
  leadUpdate: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  userFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  isAdmin: true,
  isSuperAdmin: false,
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    $transaction: database.transaction,
    siteVisit: {
      findFirst: database.siteVisitFindFirst,
      updateMany: database.siteVisitUpdateMany,
    },
    lead: { update: database.leadUpdate },
    auditLog: {
      findMany: database.auditFindMany,
      create: database.auditCreate,
    },
    user: { findFirst: database.userFindFirst },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, {
      user: {
        id: 'admin-a',
        tenantId: 'tenant-a',
        isAdmin: authState.isAdmin,
        isSuperAdmin: authState.isSuperAdmin,
        profileName: 'Admin',
      },
      tenantId: 'tenant-a',
    });
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../services/recordAccess', () => ({
  applyScope: (where: unknown) => where,
  canAccessLead: vi.fn(),
  canAccessLeadId: vi.fn(),
  canAccessSiteVisit: vi.fn(),
  getScopeClause: vi.fn(),
}));

vi.mock('../services/leadWorkflowExtras', () => ({
  getNextSiteVisitNumber: vi.fn(),
  normalizeOverdueSiteVisits: vi.fn(),
}));

vi.mock('../services/workflow', () => ({
  canTransitionStatus: vi.fn(),
}));

vi.mock('../services/rrQueue', () => ({
  assignCompletedSiteVisitToSalesInTransaction: vi.fn().mockResolvedValue({ pendingReason: null }),
  assignSiteVisitToSVCInTransaction: vi.fn(),
}));

vi.mock('../services/customFieldValidation', () => ({
  validateObjectCustomFields: vi.fn(),
}));

vi.mock('../services/leadEventTagging', () => ({
  tagLeadSiteVisitEvents: vi.fn(),
}));

vi.mock('../services/siteVisitScheduleFields', () => ({
  ensureSiteVisitScheduleFields: vi.fn(),
}));

vi.mock('../services/leadNotes', () => ({
  appendLeadProcessNote: vi.fn(),
}));

import siteVisitRouter from './siteVisits';
import { appendLeadProcessNote } from '../services/leadNotes';

const transactionClient = {
  siteVisit: {
    findFirst: database.siteVisitFindFirst,
    updateMany: database.siteVisitUpdateMany,
  },
  lead: { update: database.leadUpdate },
  auditLog: { create: database.auditCreate, findMany: database.auditFindMany },
};

const servers: Server[] = [];

async function complete(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/site-visits', siteVisitRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/site-visits/visit-a/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  completedAt: '2026-10-28T10:00:00.000Z',
  rating: 'Hot',
  feedback: 'Customer liked the villa.',
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.isAdmin = true;
  authState.isSuperAdmin = false;
  database.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  database.auditFindMany.mockResolvedValue([]);
  database.userFindFirst.mockResolvedValue({
    firstName: 'System',
    lastName: 'Admin',
    profile: { name: 'System Admin' },
  });
  database.siteVisitFindFirst.mockResolvedValue({
    id: 'visit-a',
    tenantId: 'tenant-a',
    leadId: 'lead-a',
    status: 'SCHEDULED',
    siteVisitNumber: 'SV-1',
    customFields: {},
    lead: { id: 'lead-a', status: 'PROSPECT' },
  });
  database.siteVisitUpdateMany.mockResolvedValue({ count: 1 });
  database.leadUpdate.mockResolvedValue({ id: 'lead-a', status: 'SITE_VISIT_HAPPENED' });
  database.auditCreate.mockResolvedValue({ id: 'audit-a' });
});

afterEach(() => {
  servers.splice(0).forEach((server) => server.close());
});

describe('POST /api/site-visits/:id/complete', () => {
  it('lets an admin complete a scheduled visit and moves an earlier lead to Site Visit Happened', async () => {
    database.siteVisitFindFirst
      .mockResolvedValueOnce({
        id: 'visit-a',
        tenantId: 'tenant-a',
        leadId: 'lead-a',
        status: 'SCHEDULED',
        siteVisitNumber: 'SV-1',
        customFields: {},
        lead: { id: 'lead-a', status: 'PROSPECT' },
      })
      .mockResolvedValueOnce({
        id: 'visit-a',
        status: 'COMPLETED',
        feedback: validBody.feedback,
        customFields: { schedule_rating: 'Hot' },
        completedById: 'admin-a',
        lead: { id: 'lead-a', status: 'SITE_VISIT_HAPPENED' },
      });

    const response = await complete(validBody);
    const body = await response.json() as { data: { status: string; leadStatus: string } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('COMPLETED');
    expect(body.data.leadStatus).toBe('SITE_VISIT_HAPPENED');
    expect(database.siteVisitUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'visit-a', tenantId: 'tenant-a' }),
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedById: 'admin-a',
        feedback: validBody.feedback,
        customFields: expect.objectContaining({ schedule_rating: 'Hot' }),
      }),
    }));
    expect(database.leadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-a' },
      data: { status: 'SITE_VISIT_HAPPENED' },
    });
    expect(database.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'SITE_VISIT_COMPLETED',
        newValues: expect.objectContaining({
          summary: 'System Admin marked this visit as completed',
        }),
      }),
    }));
  });

  it('does not downgrade a booked lead', async () => {
    database.siteVisitFindFirst.mockResolvedValue({
      id: 'visit-a',
      tenantId: 'tenant-a',
      leadId: 'lead-a',
      status: 'SCHEDULED',
      siteVisitNumber: 'SV-1',
      customFields: {},
      lead: { id: 'lead-a', status: 'BOOKED' },
    });

    const response = await complete(validBody);

    expect(response.status).toBe(200);
    expect(database.leadUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    authState.isAdmin = false;
    const response = await complete(validBody);
    const body = await response.json() as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/admin/i);
    expect(database.siteVisitUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the visit is already completed or cancelled', async () => {
    database.siteVisitFindFirst.mockResolvedValueOnce({ id: 'visit-a', tenantId: 'tenant-a', status: 'COMPLETED', lead: { status: 'BOOKED' } });
    const completed = await complete(validBody);
    expect(completed.status).toBe(409);
    expect((await completed.json() as { error: string }).error).toBe('Site visit is already Completed');

    database.siteVisitFindFirst.mockResolvedValueOnce({
      id: 'visit-a',
      tenantId: 'tenant-a',
      status: 'CANCELLED',
      cancellationReason: 'Customer declined',
      lead: { status: 'PROSPECT' },
    });
    const cancelled = await complete(validBody);
    expect(cancelled.status).toBe(409);
    expect((await cancelled.json() as { error: string }).error).toBe('Cancelled visits cannot be completed');
    expect(database.siteVisitUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a future time and missing rating or feedback', async () => {
    const future = await complete({ ...validBody, completedAt: '2999-01-01T00:00:00.000Z' });
    expect(future.status).toBe(400);

    const rating = await complete({ ...validBody, rating: 'Excellent' });
    expect(rating.status).toBe(400);

    const feedback = await complete({ ...validBody, feedback: '   ' });
    expect(feedback.status).toBe(400);
    expect(database.siteVisitUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a visit outside the tenant', async () => {
    database.siteVisitFindFirst.mockResolvedValueOnce(null);
    const response = await complete(validBody);
    expect(response.status).toBe(404);
    expect(database.siteVisitUpdateMany).not.toHaveBeenCalled();
  });

  it('does not write a second history entry when the completion loses a race', async () => {
    database.siteVisitUpdateMany.mockResolvedValueOnce({ count: 0 });
    database.siteVisitFindFirst
      .mockResolvedValueOnce({
        id: 'visit-a',
        tenantId: 'tenant-a',
        leadId: 'lead-a',
        status: 'SCHEDULED',
        lead: { id: 'lead-a', status: 'NEW' },
      })
      .mockResolvedValueOnce({
        id: 'visit-a',
        status: 'COMPLETED',
        lead: { status: 'SITE_VISIT_HAPPENED' },
      });

    const response = await complete(validBody);

    expect(response.status).toBe(200);
    expect(database.auditCreate).not.toHaveBeenCalled();
    expect(database.leadUpdate).not.toHaveBeenCalled();
  });

  it('rolls the completion back when a later write in the same transaction fails', async () => {
    vi.mocked(appendLeadProcessNote).mockRejectedValueOnce(new Error('note failed'));
    const response = await complete(validBody);

    expect(response.status).toBe(500);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.siteVisitUpdateMany).toHaveBeenCalledTimes(1);
    expect(database.leadUpdate).toHaveBeenCalledTimes(1);
  });
});
