import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  leadFindFirst: vi.fn(),
  leadUpdate: vi.fn(),
  callDetailFindFirst: vi.fn(),
  callDetailCreate: vi.fn(),
  callDetailUpdate: vi.fn(),
  callDetailDelete: vi.fn(),
  auditLogCreate: vi.fn(),
  followUpFindFirst: vi.fn(),
  followUpUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    $transaction: database.transaction,
    lead: { findFirst: database.leadFindFirst, update: database.leadUpdate },
    callDetail: {
      findMany: vi.fn(),
      findFirst: database.callDetailFindFirst,
      create: database.callDetailCreate,
      update: database.callDetailUpdate,
      delete: database.callDetailDelete,
    },
    followUp: {
      findFirst: database.followUpFindFirst,
      update: database.followUpUpdate,
    },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, {
      user: { id: 'user-a', tenantId: 'platform-tenant', isSuperAdmin: true },
      tenantId: 'tenant-a',
    });
    next();
  },
}));

vi.mock('../middleware/authorization', () => ({
  authorize: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../services/recordAccess', () => ({
  canAccessLeadId: vi.fn().mockResolvedValue(true),
}));
vi.mock('../services/leadEventTagging', () => ({
  tagLeadFollowUpEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/leadNotes', () => ({
  appendLeadProcessNote: vi.fn().mockResolvedValue(undefined),
}));

import callDetailsRouter from './callDetails';
import { tagLeadFollowUpEvents } from '../services/leadEventTagging';

const transactionClient = {
  lead: {
    findFirst: database.leadFindFirst,
    update: database.leadUpdate,
  },
  callDetail: {
    create: database.callDetailCreate,
    update: database.callDetailUpdate,
    delete: database.callDetailDelete,
  },
  auditLog: { create: database.auditLogCreate },
  followUp: {
    findFirst: database.followUpFindFirst,
    update: database.followUpUpdate,
  },
};
const servers: Server[] = [];

async function createCall(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/call-details', callDetailsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/call-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function requestCall(method: 'GET' | 'PUT' | 'DELETE', id: string, body?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/call-details', callDetailsRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/call-details/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  database.leadFindFirst.mockResolvedValue({ id: 'lead-a', status: 'PROSPECT' });
  database.leadUpdate.mockResolvedValue({ id: 'lead-a', status: 'INCOMING' });
  database.callDetailFindFirst.mockResolvedValue({
    id: 'call-a',
    tenantId: 'tenant-a',
    leadId: 'lead-a',
    callType: 'INBOUND',
    startAt: new Date('2026-10-12T09:00:00.000Z'),
    endAt: new Date('2026-10-12T09:05:00.000Z'),
    status: 'COMPLETED',
    notes: 'Previous note',
    ownerId: 'user-a',
    caseId: null,
  });
  database.callDetailCreate.mockResolvedValue({
    id: 'call-a',
    callType: 'OUTBOUND',
    startAt: new Date('2026-10-12T09:00:00.000Z'),
    endAt: new Date('2026-10-12T09:05:00.000Z'),
    notes: 'Discussed project',
    createdBy: { id: 'user-a', firstName: 'Test', lastName: 'User' },
  });
  database.callDetailUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'call-a',
    callType: 'INBOUND',
    startAt: new Date('2026-10-12T09:00:00.000Z'),
    endAt: new Date('2026-10-12T09:05:00.000Z'),
    status: 'COMPLETED',
    notes: data.notes || 'Previous note',
    ownerId: 'user-a',
    caseId: null,
  }));
  database.callDetailDelete.mockResolvedValue({});
  database.auditLogCreate.mockResolvedValue({});
  database.followUpFindFirst.mockResolvedValue(null);
  database.followUpUpdate.mockResolvedValue({});
  database.transaction.mockImplementation((callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('lead call details', () => {
  it('returns call details only when they belong to the authenticated tenant and accessible lead', async () => {
    const response = await requestCall('GET', 'call-a');
    const body = await response.json() as { data: { leadStatus: string; leadStatusChanged: boolean } };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { id: 'call-a', leadId: 'lead-a' } });
    expect(database.callDetailFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'call-a', tenantId: 'tenant-a' },
      include: expect.objectContaining({
        createdBy: expect.any(Object),
        lead: expect.any(Object),
      }),
    }));
  });

  it('updates only a call in the authenticated tenant and audits the change', async () => {
    const response = await requestCall('PUT', 'call-a', { notes: 'Updated note' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { id: 'call-a', notes: 'Updated note' } });
    expect(database.callDetailFindFirst).toHaveBeenCalledWith({
      where: { id: 'call-a', tenantId: 'tenant-a' },
    });
    expect(database.callDetailUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'call-a' },
      data: expect.objectContaining({ notes: 'Updated note', lastModifiedById: 'user-a' }),
    }));
    expect(database.auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', action: 'UPDATE', objectType: 'CallDetail' }),
    }));
  });

  it('deletes only a call in the authenticated tenant and records its deletion', async () => {
    const response = await requestCall('DELETE', 'call-a');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(database.callDetailFindFirst).toHaveBeenCalledWith({
      where: { id: 'call-a', tenantId: 'tenant-a' },
    });
    expect(database.callDetailDelete).toHaveBeenCalledWith({ where: { id: 'call-a' } });
    expect(database.auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', action: 'DELETE', objectType: 'CallDetail' }),
    }));
  });

  it('creates an independent call record with type, times, and notes', async () => {
    const response = await createCall({
      leadId: 'lead-a',
      callType: 'OUTBOUND',
      callFrom: '+911234567890',
      callTo: '+919876543210',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T09:05:00.000Z',
      executiveContactNo: '+919876543210',
      landingNumber: 'Main line',
      status: 'COMPLETED',
      parentId: 'lead-a',
      parentUrl: 'http://localhost:3000/leads/lead-a',
      recordingFile: 'https://example.com/call.mp3',
      notes: 'Discussed project',
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, data: { id: 'call-a', callType: 'OUTBOUND', notes: 'Discussed project' } });
    expect(database.callDetailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        leadId: 'lead-a',
        createdById: 'user-a',
        callType: 'OUTBOUND',
        callFrom: '+911234567890',
        callTo: '+919876543210',
        duration: 300,
        executiveContactNo: '+919876543210',
        landingNumber: 'Main line',
        status: 'COMPLETED',
        parentId: 'lead-a',
        parentUrl: 'http://localhost:3000/leads/lead-a',
        recordingFile: 'https://example.com/call.mp3',
        notes: 'Discussed project',
      }),
    }));
    expect(database.auditLogCreate).toHaveBeenCalled();
    expect(database.leadUpdate).not.toHaveBeenCalled();
  });

  it('moves a New lead to Incoming when any call outcome is saved', async () => {
    database.leadFindFirst.mockResolvedValue({ id: 'lead-a', status: 'NEW' });

    const response = await createCall({
      leadId: 'lead-a',
      callType: 'OUTBOUND',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T09:05:00.000Z',
      status: 'NO_ANSWER',
    });
    const body = await response.json() as { data: { leadStatus: string; leadStatusChanged: boolean } };

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ leadStatus: 'INCOMING', leadStatusChanged: true });
    expect(database.leadFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-a', tenantId: 'tenant-a' },
    }));
    expect(database.leadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-a' },
      data: { status: 'INCOMING' },
    });
  });

  it('does not change the lead status when the call log fails to save', async () => {
    database.leadFindFirst.mockResolvedValue({ id: 'lead-a', status: 'NEW' });
    database.callDetailCreate.mockRejectedValueOnce(new Error('insert failed'));

    const response = await createCall({
      leadId: 'lead-a',
      callType: 'INBOUND',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T09:05:00.000Z',
      status: 'BUSY',
    });

    expect(response.status).toBe(500);
    expect(database.leadUpdate).not.toHaveBeenCalled();
  });

  it('accepts a call whose end time is the same as its start time', async () => {
    const response = await createCall({
      leadId: 'lead-a',
      callType: 'OUTBOUND',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T09:00:00.000Z',
    });

    expect(response.status).toBe(201);
    expect(database.callDetailCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ duration: 0 }),
    }));
  });

  it('rejects a call whose end time is not after its start time', async () => {
    const response = await createCall({
      leadId: 'lead-a',
      callType: 'INBOUND',
      startAt: '2026-10-12T09:05:00.000Z',
      endAt: '2026-10-12T09:00:00.000Z',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, error: 'End time must be after start time' });
    expect(database.callDetailCreate).not.toHaveBeenCalled();
  });

  it.each(['NO_ANSWER', 'BUSY', 'VOICEMAIL', 'CANCELLED'])(
    'completes the earliest scheduled follow-up when a call is logged with status %s',
    async (status) => {
      database.followUpFindFirst.mockResolvedValueOnce({
        id: 'follow-up-a',
        isMissed: false,
      });
      const response = await createCall({
        leadId: 'lead-a',
        callType: 'OUTBOUND',
        startAt: '2026-10-12T09:00:00.000Z',
        endAt: '2026-10-12T09:05:00.000Z',
        status,
      });

      expect(response.status).toBe(201);
      expect(database.followUpFindFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-a',
          leadId: 'lead-a',
          isCompleted: false,
          isMissed: false,
        },
        orderBy: { dueDate: 'asc' },
      });
      expect(database.followUpUpdate).toHaveBeenCalledWith({
        where: { id: 'follow-up-a' },
        data: {
          isCompleted: true,
          completedAt: expect.any(Date),
          isMissed: false,
          missedAt: null,
        },
      });
      expect(database.auditLogCreate).toHaveBeenCalledTimes(2);
      expect(tagLeadFollowUpEvents).toHaveBeenCalledWith(transactionClient, 'tenant-a', 'lead-a');
    },
  );

  it('leaves a missed follow-up untouched when a call is logged', async () => {
    database.followUpFindFirst.mockResolvedValueOnce(null);
    const response = await createCall({
      leadId: 'lead-a',
      callType: 'OUTBOUND',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T09:05:00.000Z',
      status: 'NO_ANSWER',
    });

    expect(response.status).toBe(201);
    expect(database.followUpFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isCompleted: false, isMissed: false }),
    }));
    expect(database.followUpUpdate).not.toHaveBeenCalled();
  });

});
