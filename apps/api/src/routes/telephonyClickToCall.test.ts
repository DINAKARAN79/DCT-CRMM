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
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    telephonySetting: { findUnique: dialpadMocks.settingsFindUnique },
    lead: { findFirst: dialpadMocks.findLead },
    callDetail: { findFirst: dialpadMocks.findCall, update: dialpadMocks.updateCall },
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
  it('associates a Bizcall UUID with the newly initiated dialpad call', async () => {
    dialpadMocks.findLead.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'cmup3jbyv0000r1pndvbpn4my',
      ownerId: null,
      creatorId: null,
    });
    dialpadMocks.findCall.mockResolvedValue({ id: 'call-1' });
    dialpadMocks.updateCall.mockResolvedValue({ id: 'call-1' });

    const response = await postTo('dialpad-event', {
      callUuid: 'bizcall-uuid',
      leadId: 'lead-1',
      type: 'BIZCALL_CALL_STARTING',
    });

    expect(response.status).toBe(200);
    expect(dialpadMocks.findCall).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { providerCallId: 'bizcall-uuid' },
          { source: 'dialpad', providerCallId: null },
        ],
      }),
    }));
    expect(dialpadMocks.updateCall).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: expect.objectContaining({ providerCallId: 'bizcall-uuid', status: 'Calling' }),
    });
  });
});
