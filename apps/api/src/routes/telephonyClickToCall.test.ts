import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const placed = vi.hoisted(() => vi.fn());
const dialpadMocks = vi.hoisted(() => ({
  hasPermission: vi.fn().mockResolvedValue(true),
  findLead: vi.fn(),
  findCall: vi.fn(),
  updateCall: vi.fn(),
  createCall: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
  appendNote: vi.fn(),
  settingsFindUnique: vi.fn(),
  canAccessLead: vi.fn().mockResolvedValue(true),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, {
      user: { id: 'cmup3jc0m007ir1pnj1ic1a9u', tenantId: 'cmup3jbyv0000r1pndvbpn4my', isSuperAdmin: false, isAdmin: false },
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
    });
    next();
  },
}));

vi.mock('../services/clickToCall', () => ({
  placeClickToCall: placed,
  maskPhone: (value: string) => value.length > 4 ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}` : '****',
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    telephonySetting: { findUnique: dialpadMocks.settingsFindUnique },
    lead: { findFirst: dialpadMocks.findLead },
    callDetail: { findFirst: dialpadMocks.findCall, update: dialpadMocks.updateCall, create: dialpadMocks.createCall },
    auditLog: { create: dialpadMocks.createAudit },
    $transaction: dialpadMocks.transaction,
  },
}));

vi.mock('../services/effectivePermissions', () => ({
  EffectivePermissionService: { hasPermission: dialpadMocks.hasPermission },
}));

vi.mock('../services/recordAccess', () => ({
  canAccessLead: dialpadMocks.canAccessLead,
}));

vi.mock('../services/callLogStatus', () => ({
  applyCallLogStatusRule: vi.fn(),
}));

vi.mock('../services/leadNotes', () => ({
  appendLeadProcessNote: dialpadMocks.appendNote,
}));

vi.mock('../services/telephonyCredentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/telephonyCredentials')>();
  return {
    ...actual,
    decryptTelephonyToken: vi.fn(),
  };
});

import telephonyRouter from './telephonyClickToCall';
import { decryptTelephonyToken, TelephonyCredentialError } from '../services/telephonyCredentials';

const servers: Server[] = [];

async function postTo(path: string, body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/telephony', telephonyRouter);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/telephony/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(body: Record<string, unknown>) {
  return postTo('click-to-call', body);
}

afterEach(async () => {
  placed.mockReset();
  dialpadMocks.findLead.mockReset();
  dialpadMocks.findCall.mockReset();
  dialpadMocks.updateCall.mockReset();
  dialpadMocks.createCall.mockReset();
  dialpadMocks.createAudit.mockReset();
  dialpadMocks.transaction.mockReset();
  dialpadMocks.appendNote.mockReset();
  dialpadMocks.settingsFindUnique.mockReset();
  dialpadMocks.hasPermission.mockReset().mockResolvedValue(true);
  dialpadMocks.canAccessLead.mockReset().mockResolvedValue(true);
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('GET /api/telephony/client-config', () => {
  async function getClientConfig() {
    const app = express();
    app.use('/api/telephony', telephonyRouter);
    const server = app.listen(0);
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
    return fetch(`http://127.0.0.1:${address.port}/api/telephony/client-config`);
  }

  it('returns a reason code for permission, missing settings, inactive, and missing-key states', async () => {
    const cases = [
      { allowed: false, settings: null, reasonCode: 'NO_PERMISSION' },
      { allowed: true, settings: null, reasonCode: 'NOT_CONFIGURED' },
      { allowed: true, settings: { isActive: false, encryptedCredentials: 'cipher' }, reasonCode: 'DISABLED' },
      { allowed: true, settings: { isActive: true, encryptedCredentials: null }, reasonCode: 'KEY_MISSING' },
    ] as const;
    for (const testCase of cases) {
      dialpadMocks.hasPermission.mockResolvedValue(testCase.allowed);
      dialpadMocks.settingsFindUnique.mockResolvedValue(testCase.settings);
      const response = await getClientConfig();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: false,
        data: { active: false, reasonCode: testCase.reasonCode },
      });
    }
  });

  it('distinguishes an unreadable saved key and activates only after decryption succeeds', async () => {
    dialpadMocks.hasPermission.mockResolvedValue(true);
    dialpadMocks.settingsFindUnique.mockResolvedValue({
      isActive: true,
      encryptedCredentials: 'cipher',
      dialpadUrl: 'https://bizcall.cxteletech.com/embed/dialpad',
      dialpadMode: 'DOCKED',
      callMethod: 'SERVER_API',
      theme: 'CRM',
      defaultDockState: 'COLLAPSED',
      maskNumbers: false,
    });
    vi.mocked(decryptTelephonyToken).mockImplementationOnce(() => {
      throw new TelephonyCredentialError('unreadable', 'CREDENTIALS_KEY_MISSING');
    });
    const unreadable = await getClientConfig();
    expect(await unreadable.json()).toMatchObject({
      ok: false,
      data: { active: false, reasonCode: 'KEY_UNREADABLE' },
    });

    vi.mocked(decryptTelephonyToken).mockReturnValueOnce('fake-token');
    const active = await getClientConfig();
    expect(await active.json()).toMatchObject({
      ok: true,
      data: { active: true, reasonCode: 'ACTIVE' },
    });
  });

  it('returns a diagnostic error code when the settings table cannot be read', async () => {
    dialpadMocks.hasPermission.mockResolvedValue(true);
    dialpadMocks.settingsFindUnique.mockRejectedValue(new Error('relation does not exist'));
    const response = await getClientConfig();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'TELEPHONY_CONFIG_UNAVAILABLE',
    });
  });
});

describe('POST /api/telephony/click-to-call', () => {
  it('uses the session user and tenant and drops ids from the body', async () => {
    placed.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      code: 'INITIATED',
      step: 'sent_to_provider',
      message: 'Calling Pam Beesly... your phone will ring shortly.',
      leadName: 'Pam Beesly',
      leadStatus: 'INCOMING',
      statusChanged: true,
      callDetailId: 'call-1',
    });
    const response = await post({
      leadId: 'cmvtngb2g003q11l1lytc08n7',
      phoneField: 'secondaryPhone',
      agentId: 'spoof-agent',
      tenantId: 'spoof-tenant',
      recordID: 'spoof-record',
    });
    expect(response.status).toBe(200);
    expect(placed).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: 'cmup3jc0m007ir1pnj1ic1a9u' }),
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      leadId: 'cmvtngb2g003q11l1lytc08n7',
      phoneField: 'secondaryPhone',
    });
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, code: 'INITIATED', step: 'sent_to_provider' });
    expect(JSON.stringify(body)).not.toContain('spoof-agent');
    expect(JSON.stringify(body)).not.toContain('spoof-tenant');
    expect(JSON.stringify(body)).not.toContain('spoof-record');
  });
});

describe('POST /api/telephony/dialpad-event', () => {
  const configureTransaction = () => {
    dialpadMocks.createAudit.mockResolvedValue({});
    dialpadMocks.transaction.mockImplementation((callback) => callback({
      callDetail: {
        findFirst: dialpadMocks.findCall,
        update: dialpadMocks.updateCall,
        create: dialpadMocks.createCall,
      },
      auditLog: { create: dialpadMocks.createAudit },
    }));
  };

  it('associates a Bizcall UUID with the newly initiated dialpad call', async () => {
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: null,
    });

    const existing = {
      id: 'call-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: 'lead-1',
      callTo: '+12125550123',
      providerCallId: null,
      callId: null,
      answeredAt: null,
      status: 'Initiated',
      startAt: new Date(),
      duration: 0,
      disposition: null,
      notes: null,
    };
    dialpadMocks.findCall.mockResolvedValue(existing);
    dialpadMocks.updateCall.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    configureTransaction();

    const response = await postTo('dialpad-event', {
      callUuid: 'bizcall-uuid',
      leadId: 'lead-1',
      number: '+12125550123',
      event: 'BIZCALL_CALL_STARTING',
      tenantId: 'spoof-tenant',
      userId: 'spoof-user',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.findCall).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'cmup3jbyv0000r1pndvbpn4my',
        createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
        OR: [{ providerCallId: 'bizcall-uuid' }, { callId: 'bizcall-uuid' }],
      }),
    }));
    expect(dialpadMocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerCallId: 'bizcall-uuid', status: 'Calling' }),
    }));
  });

  it('creates a manual call-started record using only authenticated tenant and user ids', async () => {
    dialpadMocks.settingsFindUnique.mockResolvedValue({ isActive: true, encryptedCredentials: 'cipher' });
    dialpadMocks.createCall.mockResolvedValue({ id: 'manual-call' });
    dialpadMocks.createAudit.mockResolvedValue({});

    const response = await postTo('dialpad-call-started', { number: '+12125550123' });

    expect(response.status).toBe(201);
    expect(dialpadMocks.settingsFindUnique).toHaveBeenCalledWith({
      where: { tenantId: 'cmup3jbyv0000r1pndvbpn4my' },
    });
    expect(dialpadMocks.createCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'cmup3jbyv0000r1pndvbpn4my',
        createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
        leadId: null,
        callTo: '+12125550123',
      }),
    }));
    expect(JSON.stringify(dialpadMocks.createAudit.mock.calls)).not.toContain('+12125550123');
  });

  it('returns 404 for a lead outside the authenticated tenant', async () => {
    dialpadMocks.findLead.mockResolvedValue(null);
    const response = await postTo('dialpad-event', {
      event: 'BIZCALL_CALL_STARTING',
      leadId: 'foreign-lead',
      number: '+12125550123',
    });

    expect(response.status).toBe(404);
    expect(dialpadMocks.transaction).not.toHaveBeenCalled();
  });

  it('records a manual call without a lead using the authenticated tenant and user', async () => {
    dialpadMocks.findCall.mockResolvedValue(null);
    dialpadMocks.createCall.mockResolvedValue({
      id: 'manual-call',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: null,
      callTo: '+12125550123',
      status: 'Calling',
    });
    configureTransaction();

    const response = await postTo('dialpad-event', {
      event: 'BIZCALL_CALL_STARTING',
      number: '+12125550123',
      tenantId: 'spoof-tenant',
      userId: 'spoof-user',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.createCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'cmup3jbyv0000r1pndvbpn4my',
        createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
        leadId: null,
        callTo: '+12125550123',
      }),
    }));
    expect(JSON.stringify(dialpadMocks.createAudit.mock.calls)).not.toContain('+12125550123');
  });

  it('marks a call connected and saves the provider call UUID', async () => {
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: 'cmup3jc0m007ir1pnj1ic1a9u',
    });
    const existing = {
      id: 'call-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: 'lead-1',
      callTo: '+12125550123',
      providerCallId: null,
      callId: null,
      answeredAt: null,
      status: 'Calling',
      startAt: new Date(),
      duration: 0,
      disposition: null,
      notes: null,
    };
    dialpadMocks.findCall.mockResolvedValue(existing);
    dialpadMocks.updateCall.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    configureTransaction();

    const response = await postTo('dialpad-event', {
      event: 'BIZCALL_CALL_CONNECTED',
      leadId: 'lead-1',
      number: '+12125550123',
      callUuid: 'bizcall-uuid',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerCallId: 'bizcall-uuid', status: 'Connected', answeredAt: expect.any(Date) }),
    }));
  });

  it('ends a connected call with the reported duration and audits only a masked number', async () => {
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: 'cmup3jc0m007ir1pnj1ic1a9u',
    });
    const existing = {
      id: 'call-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: 'lead-1',
      callTo: '+12125550123',
      providerCallId: 'bizcall-uuid',
      callId: null,
      answeredAt: new Date(),
      status: 'Connected',
      startAt: new Date(),
      duration: 0,
      disposition: null,
      notes: null,
    };
    dialpadMocks.findCall.mockResolvedValue(existing);
    dialpadMocks.updateCall.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    configureTransaction();

    const response = await postTo('dialpad-event', {
      event: 'BIZCALL_CALL_ENDED',
      leadId: 'lead-1',
      callUuid: 'bizcall-uuid',
      duration: 145,
      durationFormatted: '02:25',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Ended', duration: 145 }),
    }));
    expect(JSON.stringify(dialpadMocks.createAudit.mock.calls)).not.toContain('+12125550123');
  });

  it('does not move an ended call backwards when CALL_STARTING arrives late', async () => {
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: 'cmup3jc0m007ir1pnj1ic1a9u',
    });
    dialpadMocks.findCall.mockResolvedValue({
      id: 'call-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: 'lead-1',
      callTo: '+12125550123',
      providerCallId: 'bizcall-uuid',
      callId: null,
      answeredAt: new Date(),
      status: 'Ended',
      startAt: new Date(),
      duration: 145,
      disposition: null,
      notes: null,
    });
    configureTransaction();

    const response = await postTo('dialpad-event', {
      event: 'BIZCALL_CALL_STARTING',
      leadId: 'lead-1',
      callUuid: 'bizcall-uuid',
      number: '+12125550123',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.updateCall).not.toHaveBeenCalled();
    expect(dialpadMocks.createAudit).not.toHaveBeenCalled();
  });

  it('saves disposition notes once without copying raw notes into audit values', async () => {
    const existing = {
      id: 'call-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      createdById: 'cmup3jc0m007ir1pnj1ic1a9u',
      leadId: 'lead-1',
      callTo: '+12125550123',
      providerCallId: 'bizcall-uuid',
      callId: null,
      answeredAt: new Date(),
      status: 'Ended',
      startAt: new Date(),
      duration: 145,
      disposition: null,
      notes: null,
    };
    const updated = { ...existing, disposition: 'Interested', notes: 'Raw customer note that must not be in audit.' };
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: 'cmup3jc0m007ir1pnj1ic1a9u',
    });
    dialpadMocks.findCall.mockResolvedValueOnce(existing).mockResolvedValueOnce(updated);
    dialpadMocks.updateCall.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    dialpadMocks.appendNote.mockResolvedValue({});
    configureTransaction();

    const body = {
      event: 'BIZCALL_DISPOSITION_SUBMITTED',
      leadId: 'lead-1',
      callUuid: 'bizcall-uuid',
      disposition: 'Interested',
      notes: 'Raw customer note that must not be in audit.',
    };
    const response = await postTo('dialpad-event', body);

    expect(response.status).toBe(200);
    expect(dialpadMocks.appendNote).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dialpadMocks.createAudit.mock.calls)).not.toContain('Raw customer note');
    expect(dialpadMocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ disposition: 'Interested', notes: 'Raw customer note that must not be in audit.' }),
    }));

    const duplicateResponse = await postTo('dialpad-event', body);
    expect(duplicateResponse.status).toBe(200);
    expect(dialpadMocks.appendNote).toHaveBeenCalledTimes(1);
  });
});
