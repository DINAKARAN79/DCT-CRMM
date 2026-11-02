import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import router from './superAdminReporting';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  tenant: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  user: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  lead: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  siteVisit: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  project: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  unit: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  quotation: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  booking: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  receipt: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  permission: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  platformReportExecutionAudit: { create: vi.fn() },
  platformReportDefinition: {
    findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  },
  platformDashboardDefinition: {
    findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  },
}));

const servers: Array<ReturnType<ReturnType<typeof express>['listen']>> = [];

vi.mock('@dct-crm/db', () => ({ prisma: prismaMock }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
    (req as any).user = {
      id: 'admin-1',
      email: 'admin@example.test',
      tenantId: 'home-tenant',
      isSuperAdmin: token === 'Bearer super-admin',
    };
    return next();
  },
}));

async function createServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/super-admin/reporting', router);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return `http://127.0.0.1:${address.port}/api/super-admin/reporting`;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(0);
  prismaMock.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'Acme', currency: 'INR' }]);
  prismaMock.tenant.count.mockResolvedValue(1);
  for (const model of [
    prismaMock.user,
    prismaMock.lead,
    prismaMock.siteVisit,
    prismaMock.project,
    prismaMock.unit,
    prismaMock.quotation,
    prismaMock.booking,
    prismaMock.receipt,
  ]) {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    model.groupBy.mockResolvedValue([]);
    model.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  }
  prismaMock.user.count.mockResolvedValue(33);
  prismaMock.lead.count.mockResolvedValue(128);
  prismaMock.siteVisit.count.mockResolvedValue(76);
  prismaMock.project.count.mockResolvedValue(6);
  prismaMock.unit.count.mockResolvedValue(141);
  prismaMock.quotation.count.mockResolvedValue(20);
  prismaMock.booking.count.mockResolvedValue(12);
  prismaMock.receipt.count.mockResolvedValue(17);
  prismaMock.receipt.aggregate.mockResolvedValue({ _sum: { amount: 32497803 } });
  prismaMock.receipt.groupBy.mockResolvedValue([{
    tenantId: 'tenant-1',
    _sum: { amount: 32497803 },
    _count: { _all: 17 },
  }]);
  prismaMock.platformReportExecutionAudit.create.mockResolvedValue({ id: 'audit-1' });
});

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  servers.length = 0;
});

const adminHeaders = { authorization: 'Bearer super-admin', 'content-type': 'application/json' };

describe('Super Admin reporting API', () => {
  it('requires authentication and Super Admin access at router scope', async () => {
    const base = await createServer();
    const unauthenticated = await fetch(`${base}/registry`);
    const regularUser = await fetch(`${base}/registry`, { headers: { authorization: 'Bearer user' } });

    expect(unauthenticated.status).toBe(401);
    expect(regularUser.status).toBe(403);
    const metricUser = await fetch(`${base}/metrics/leads-total/records`, { headers: { authorization: '******' } });
    expect(metricUser.status).toBe(403);
  });

  it('uses the same registered metric query for each dashboard card and its record total', async () => {
    const base = await createServer();
    const cardsResponse = await fetch(`${base}/metrics`, { headers: adminHeaders });
    expect(cardsResponse.status, await cardsResponse.clone().text()).toBe(200);
    const cardsPayload = await cardsResponse.json() as {
      data: { cards: Array<{ id: string; value: number; recordCount: number }> };
    };

    expect(cardsPayload.data.cards.length).toBeGreaterThanOrEqual(17);
    for (const card of cardsPayload.data.cards) {
      const [recordsResponse, summaryResponse] = await Promise.all([
        fetch(`${base}/metrics/${card.id}/records`, { headers: adminHeaders }),
        fetch(`${base}/metrics/${card.id}/summary`, { headers: adminHeaders }),
      ]);
      expect(recordsResponse.status, card.id).toBe(200);
      expect(summaryResponse.status, `${card.id}: ${await summaryResponse.clone().text()}`).toBe(200);
      const recordsPayload = await recordsResponse.json() as { data: { total: number } };
      const summaryPayload = await summaryResponse.json() as {
        data: {
          total: number;
          value: number;
          companyBreakdown: Array<{ count: number; value?: number }>;
        };
      };
      expect(recordsPayload.data.total, card.id).toBe(card.recordCount);
      expect(summaryPayload.data.total, card.id).toBe(card.recordCount);
      expect(summaryPayload.data.value, card.id).toBe(card.value);
      if (card.id.startsWith('approved-payments-')) {
        expect(summaryPayload.data.companyBreakdown.reduce((total, company) => total + (company.value || 0), 0)).toBe(card.value);
      }
    }
  });

  it('applies metric search, sorting, date, company, and pagination on the server', async () => {
    prismaMock.lead.findMany.mockResolvedValue([]);
    prismaMock.lead.count.mockResolvedValue(128);
    const base = await createServer();
    const response = await fetch(
      `${base}/metrics/leads-total/records?page=2&pageSize=50&sort=leadNumber&order=asc&search=LEAD&companyIds=tenant-1&dateFrom=2026-10-01T00%3A00%3A00.000Z`,
      { headers: adminHeaders },
    );
    const payload = await response.json() as { data: { total: number; page: number; pageSize: number } };
    const call = prismaMock.lead.findMany.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ total: 128, page: 2, pageSize: 50 });
    expect(call.take).toBe(50);
    expect(call.skip).toBe(50);
    expect(call.orderBy).toEqual({ leadNumber: 'asc' });
    expect(JSON.stringify(call.where)).toContain('"tenantId":{"in":["tenant-1"]}');
    expect(JSON.stringify(call.where)).toContain('"createdAt":{"gte":"2026-10-01T00:00:00.000Z"}');
    expect(JSON.stringify(call.where)).toContain('"leadNumber":{"contains":"LEAD"');
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it('sorts the Company column by the related tenant name on the server', async () => {
    const base = await createServer();
    const response = await fetch(`${base}/metrics/leads-total/records?sort=company&order=asc`, { headers: adminHeaders });
    const call = prismaMock.lead.findMany.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(call.orderBy).toEqual({ tenant: { name: 'asc' } });
  });

  it('lets an explicit date range replace a metric card default date filter', async () => {
    const base = await createServer();
    const response = await fetch(
      `${base}/metrics/leads-created-today/records?dateFrom=2025-01-01T00%3A00%3A00.000Z`,
      { headers: adminHeaders },
    );
    const where = prismaMock.lead.findMany.mock.calls[0][0].where;
    const serializedWhere = JSON.stringify(where);

    expect(response.status).toBe(200);
    expect(serializedWhere.match(/createdAt/g)).toHaveLength(1);
    expect(serializedWhere).toContain('"gte":"2025-01-01T00:00:00.000Z"');
  });

  it('returns company IDs with a breakdown whose counts match the metric total', async () => {
    prismaMock.lead.count.mockResolvedValue(128);
    prismaMock.lead.groupBy.mockResolvedValue([{
      tenantId: 'tenant-1',
      status: 'NEW',
      _count: { _all: 128 },
    }]);
    const base = await createServer();
    const response = await fetch(`${base}/metrics/leads-total/summary`, { headers: adminHeaders });
    const payload = await response.json() as {
      data: {
        total: number;
        companyBreakdown: Array<{ companyId: string; company: string; count: number }>;
        companyBreakdownTruncated: boolean;
        statusBreakdown: Array<{ companyId: string; company: string; status: string; count: number }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.companyBreakdown).toEqual([{ companyId: 'tenant-1', company: 'Acme', count: 128 }]);
    expect(payload.data.companyBreakdown.reduce((total, company) => total + company.count, 0)).toBe(payload.data.total);
    expect(payload.data.companyBreakdownTruncated).toBe(false);
    expect(payload.data.statusBreakdown).toEqual([{
      companyId: 'tenant-1',
      company: 'Acme',
      status: 'NEW',
      count: 128,
    }]);
    expect(prismaMock.lead.groupBy.mock.calls[0][0].take).toBe(10_000);
  });

  it('does not select or return sensitive lead contact fields', async () => {
    prismaMock.lead.findMany.mockResolvedValue([{
      id: 'lead-1',
      tenantId: 'tenant-1',
      leadNumber: 'L-1',
      status: 'NEW',
      phone: '+15551234567',
      email: 'private@example.test',
    }]);
    const base = await createServer();
    const response = await fetch(`${base}/metrics/leads-total/records`, { headers: adminHeaders });
    const payload = await response.json() as { data: { records: Array<Record<string, unknown>> } };
    const select = prismaMock.lead.findMany.mock.calls[0][0].select;

    expect(response.status).toBe(200);
    expect(select).not.toHaveProperty('phone');
    expect(select).not.toHaveProperty('email');
    expect(payload.data.records[0]).not.toHaveProperty('phone');
    expect(payload.data.records[0]).not.toHaveProperty('email');
    expect(payload.data.records[0].company).toBe('Acme');
  });

  it('exports only safe fields and audits the metric, scope, filters, and rows', async () => {
    prismaMock.lead.findMany.mockResolvedValue([{
      id: 'lead-1',
      tenantId: 'tenant-1',
      leadNumber: '=HYPERLINK("https://example.test")',
      status: 'NEW',
      phone: '+15551234567',
      email: 'private@example.test',
    }]);
    prismaMock.lead.count.mockResolvedValue(1);
    const base = await createServer();
    const response = await fetch(`${base}/metrics/leads-total/export.csv?search=L-1`, { headers: adminHeaders });
    const csv = await response.text();
    const auditCalls = prismaMock.platformReportExecutionAudit.create.mock.calls;
    const audit = auditCalls[auditCalls.length - 1]?.[0].data;

    expect(response.status).toBe(200);
    expect(csv).toContain('"company"');
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).not.toContain('private@example.test');
    expect(csv).not.toContain('+15551234567');
    expect(audit).toMatchObject({
      operation: 'export-metric-csv',
      targetType: 'metric',
      targetId: 'leads-total',
      resultCount: 1,
      tenantIds: ['tenant-1'],
    });
    expect(audit.filters).toMatchObject({ search: 'L-1' });
    expect(audit.durationMs).toEqual(expect.any(Number));
  });

  it('exports a valid XLSX file and records the export audit', async () => {
    prismaMock.lead.findMany.mockResolvedValue([{
      id: 'lead-1',
      tenantId: 'tenant-1',
      leadNumber: '=HYPERLINK("https://example.test")',
      status: 'NEW',
    }]);
    prismaMock.lead.count.mockResolvedValue(1);
    const base = await createServer();
    const response = await fetch(`${base}/metrics/leads-total/export.xlsx`, { headers: adminHeaders });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const auditCalls = prismaMock.platformReportExecutionAudit.create.mock.calls;
    const audit = auditCalls[auditCalls.length - 1]?.[0].data;

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(audit).toMatchObject({
      operation: 'export-metric-xlsx',
      targetId: 'leads-total',
      resultCount: 1,
      tenantIds: ['tenant-1'],
    });
  });

  it('exposes a conservative registry and reports tenant ownership', async () => {
    const base = await createServer();
    const response = await fetch(`${base}/registry`, { headers: adminHeaders });
    const payload = await response.json() as {
      data: {
        aggregateOperations: string[];
        models: Array<{ name: string; scope: string; fields: Array<{ name: string }> }>;
      };
    };
    const lead = payload.data.models.find((model) => model.name === 'Lead');
    const user = payload.data.models.find((model) => model.name === 'User');
    const auditLog = payload.data.models.find((model) => model.name === 'AuditLog');

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, data: { aggregateOperations: ['count', 'sum', 'avg', 'min', 'max'] } });
    expect(lead).toBeDefined();
    expect(user).toBeDefined();
    expect(auditLog).toBeDefined();
    if (!lead || !user || !auditLog) throw new Error('Expected supported models to be present');
    expect(lead.scope).toBe('tenant');
    expect(lead.fields.map((field) => field.name)).toContain('status');
    expect(lead.fields.map((field) => field.name)).not.toContain('firstName');
    expect(lead.fields.map((field) => field.name)).not.toContain('phone');
    expect(lead.fields.map((field) => field.name)).not.toContain('email');
    expect(user.scope).toBe('tenant');
    expect(user.fields.map((field) => field.name)).toContain('isActive');
    expect(user.fields.map((field) => field.name)).not.toContain('email');
    expect(user.fields.map((field) => field.name)).not.toContain('isSuperAdmin');
    expect(auditLog.scope).toBe('tenant');
    expect(auditLog.fields.map((field) => field.name)).toContain('action');
    expect(auditLog.fields.map((field) => field.name)).not.toContain('oldValues');
    expect(auditLog.fields.map((field) => field.name)).not.toContain('ipAddress');
    expect(auditLog.fields.map((field) => field.name)).not.toContain('impersonatedById');
  });

  it('scopes every tenant-owned query and scopes safe to-one relation filters on both sides', async () => {
    prismaMock.lead.count.mockResolvedValue(1);
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'lead-1', status: 'NEW' }]);
    const base = await createServer();
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        model: 'Lead',
        tenantIds: ['tenant-1'],
        fields: ['id', 'status'],
        filters: [{ field: 'project.name', operator: 'equals', value: 'Harbor' }],
      }),
    });
    const payload: any = await response.json();
    const where = prismaMock.lead.findMany.mock.calls[0][0].where;

    expect(response.status).toBe(200);
    expect(payload.data.scope).toEqual({ mode: 'selected', tenantIds: ['tenant-1'] });
    expect(JSON.stringify(where)).toContain('"tenantId":{"in":["tenant-1"]}');
    expect(JSON.stringify(where)).toContain('"project":{"is":{"tenantId":{"in":["tenant-1"]}');
  });

  it('uses explicit tenant constraints for all scope but leaves global Permission unfiltered', async () => {
    prismaMock.tenant.findMany
      .mockResolvedValueOnce([{ id: 'tenant-1' }, { id: 'tenant-2' }])
      .mockResolvedValueOnce([{ id: 'tenant-1' }]);
    prismaMock.lead.count.mockResolvedValue(0);
    prismaMock.lead.findMany.mockResolvedValue([]);
    prismaMock.permission.count.mockResolvedValue(1);
    prismaMock.permission.findMany.mockResolvedValue([{ name: 'LEAD_READ' }]);
    const base = await createServer();
    const tenantResponse = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ model: 'Lead', fields: ['id'] }),
    });
    const tenantPayload: any = await tenantResponse.json();
    expect(tenantPayload.data.scope).toEqual({ mode: 'all', tenantIds: ['tenant-1', 'tenant-2'] });
    expect(prismaMock.lead.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      tenantId: { in: ['tenant-1', 'tenant-2'] },
    });

    const permissionResponse = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ model: 'Permission', tenantIds: ['tenant-1'], fields: ['name'] }),
    });
    expect(permissionResponse.status, await permissionResponse.clone().text()).toBe(200);
    expect(prismaMock.permission.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('applies OR filter groups within, and never instead of, the selected tenant scope', async () => {
    prismaMock.lead.count.mockResolvedValue(1);
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
    const base = await createServer();
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        model: 'Lead',
        tenantIds: ['tenant-1'],
        fields: ['id'],
        filterLogic: 'OR',
        filters: [
          { field: 'id', operator: 'equals', value: 'lead-1' },
          { field: 'createdAt', operator: 'gte', value: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    });
    const payload = await response.json() as { success: boolean };
    const where = prismaMock.lead.findMany.mock.calls[0][0].where;

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(where).toMatchObject({
      AND: [
        { tenantId: { in: ['tenant-1'] } },
        { OR: expect.arrayContaining([
          { id: { equals: 'lead-1' } },
          { createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') } },
        ]) },
      ],
    });
  });

  it('returns server-side per-tenant lead counts only for validated selected companies', async () => {
    prismaMock.tenant.findMany
      .mockResolvedValueOnce([{ id: 'tenant-1' }])
      .mockResolvedValueOnce([{ id: 'tenant-1', name: 'Company One', isActive: true }]);
    prismaMock.lead.groupBy.mockResolvedValue([{ tenantId: 'tenant-1', _count: { _all: 4 } }]);
    const base = await createServer();
    const response = await fetch(`${base}/tenant-analytics?tenantIds=tenant-1`, { headers: adminHeaders });
    const payload = await response.json() as {
      data: { items: Array<{ tenantId: string; tenantName: string; isActive: boolean; leadCount: number }> };
    };

    expect(response.status).toBe(200);
    expect(payload.data.items).toEqual([{
      tenantId: 'tenant-1',
      tenantName: 'Company One',
      isActive: true,
      leadCount: 4,
    }]);
    expect(prismaMock.lead.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: { in: ['tenant-1'] },
    });
  });

  it('supports tenant-name grouping without exposing tenant ownership fields', async () => {
    prismaMock.tenant.findMany
      .mockResolvedValueOnce([{ id: 'tenant-1' }])
      .mockResolvedValueOnce([{ id: 'tenant-1', name: 'Company One' }]);
    prismaMock.lead.groupBy
      .mockResolvedValueOnce([{ tenantId: 'tenant-1', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1' }]);
    const base = await createServer();
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        model: 'Lead',
        groupBy: ['tenant.name'],
        aggregates: [{ operation: 'count' }],
      }),
    });
    const payload = await response.json() as {
      data: { groups: Array<{ by: Record<string, unknown>; values: Record<string, unknown> }> };
    };

    expect(response.status).toBe(200);
    expect(payload.data.groups).toEqual([{
      by: { 'tenant.name': 'Company One' },
      values: { count: 4 },
    }]);
    expect(prismaMock.lead.groupBy.mock.calls[0][0].by).toEqual(['tenantId']);
  });

  it('rejects unknown/sensitive fields and tenant IDs not present in the database', async () => {
    const base = await createServer();
    const invalidField = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ model: 'Lead', fields: ['passwordHash'] }),
    });
    expect(invalidField.status).toBe(400);
    expect(prismaMock.lead.findMany).not.toHaveBeenCalled();

    prismaMock.tenant.findMany.mockResolvedValue([]);
    const invalidTenant = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ model: 'Lead', tenantIds: ['missing'], fields: ['id'] }),
    });
    expect(invalidTenant.status).toBe(400);
    expect(prismaMock.lead.findMany).not.toHaveBeenCalled();
  });

  it('supports validated grouped count/sum aggregations', async () => {
    prismaMock.lead.groupBy.mockResolvedValue([{
      status: 'NEW',
      _count: { _all: 2 },
      _sum: { enquiryCount: 7 },
    }]);
    prismaMock.lead.count.mockResolvedValue(2);
    const base = await createServer();
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        model: 'Lead',
        tenantIds: ['tenant-1'],
        groupBy: ['status'],
        aggregates: [
          { operation: 'count', as: 'leadCount' },
          { operation: 'sum', field: 'enquiryCount', as: 'enquiries' },
        ],
      }),
    });
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      mode: 'grouped',
      groups: [{ by: { status: 'NEW' }, values: { leadCount: 2, enquiries: 7 } }],
    });
    expect(prismaMock.lead.groupBy.mock.calls[0][0].where.AND[0]).toEqual({
      tenantId: { in: ['tenant-1'] },
    });
  });

  it('creates shared platform report definitions and rejects attempts to write system flags', async () => {
    prismaMock.platformReportDefinition.create.mockResolvedValue({
      id: 'report-1',
      name: 'Leads',
      description: null,
      definition: { model: 'Lead', fields: ['id'] },
      isSystem: false,
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
    });
    const base = await createServer();
    const created = await fetch(`${base}/reports`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Leads', definition: { model: 'Lead', fields: ['id'] } }),
    });
    const payload: any = await created.json();

    expect(created.status).toBe(201);
    expect(payload.data).toMatchObject({ id: 'report-1', isSystem: false, createdBy: 'admin-1' });
    expect(prismaMock.platformReportDefinition.create.mock.calls[0][0].data.createdBy).toBe('admin-1');

    const systemFlag = await fetch(`${base}/reports`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'System', isSystem: true, definition: { model: 'Lead', fields: ['id'] } }),
    });
    expect(systemFlag.status).toBe(400);
  });

  it('protects system definitions and duplicates saved reports as editable definitions', async () => {
    prismaMock.platformReportDefinition.findUnique.mockResolvedValue({
      id: 'system-report',
      name: 'Built-in',
      description: null,
      definition: { model: 'Lead', fields: ['id'] },
      isSystem: true,
    });
    const base = await createServer();
    const updateSystem = await fetch(`${base}/reports/system-report`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Changed', definition: { model: 'Lead', fields: ['id'] } }),
    });
    expect(updateSystem.status).toBe(403);
    expect(prismaMock.platformReportDefinition.update).not.toHaveBeenCalled();

    prismaMock.platformReportDefinition.findUnique.mockResolvedValue({
      id: 'system-report',
      name: 'Built-in',
      description: null,
      definition: { model: 'Lead', fields: ['id'] },
      isSystem: true,
    });
    prismaMock.platformReportDefinition.create.mockResolvedValue({
      id: 'report-copy',
      name: 'Built-in (copy)',
      definition: { model: 'Lead', fields: ['id'] },
      isSystem: false,
      createdBy: 'admin-1',
    });
    const duplicate = await fetch(`${base}/reports/system-report/duplicate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    const duplicatePayload: any = await duplicate.json();
    expect(duplicate.status).toBe(201);
    expect(duplicatePayload.data).toMatchObject({ isSystem: false, createdBy: 'admin-1' });
  });

  it('executes dashboard widgets with an explicit dashboard tenant scope', async () => {
    prismaMock.platformDashboardDefinition.findUnique.mockResolvedValue({
      id: 'dashboard-1',
      definition: {
        widgets: [{
          id: 'lead-count',
          title: 'Leads',
          query: { model: 'Lead', fields: ['id'] },
        }],
      },
    });
    prismaMock.lead.count.mockResolvedValue(1);
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
    const base = await createServer();
    const response = await fetch(`${base}/dashboards/dashboard-1/run`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scope: { mode: 'selected', tenantIds: ['tenant-1'] } }),
    });
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.scope).toEqual({ mode: 'selected', tenantIds: ['tenant-1'] });
    expect(payload.data.widgets[0].data.scope).toEqual({ mode: 'selected', tenantIds: ['tenant-1'] });
    expect(prismaMock.lead.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      tenantId: { in: ['tenant-1'] },
    });
    expect(prismaMock.platformReportExecutionAudit.create.mock.calls[0][0].data.tenantIds).toEqual(['tenant-1']);
  });

  it('prevents exporting grouped reports as raw-record CSV', async () => {
    prismaMock.platformReportDefinition.findUnique.mockResolvedValue({
      id: 'grouped-report',
      definition: { model: 'Lead', groupBy: ['status'], aggregates: [{ operation: 'count' }] },
    });
    const base = await createServer();
    const response = await fetch(`${base}/reports/grouped-report/export.csv`, { headers: adminHeaders });
    const payload: any = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('record reports only');
  });

  it('exports saved records as formula-safe CSV', async () => {
    prismaMock.platformReportDefinition.findUnique.mockResolvedValue({
      id: 'plain-report',
      definition: { model: 'Lead', fields: ['id', 'leadNumber'], tenantIds: ['tenant-1'] },
    });
    prismaMock.lead.count.mockResolvedValue(1);
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'lead-1', leadNumber: '=1+1' }]);
    const base = await createServer();
    const response = await fetch(`${base}/reports/plain-report/export.csv`, { headers: adminHeaders });
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(csv).toContain("'=1+1");
    expect(response.headers.get('content-disposition')).toContain('.csv');
  });
});
