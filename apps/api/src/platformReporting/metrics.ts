import { withPlatformReadOnly } from './engine';
import type { DataQuery } from './engine';

export interface PlatformMetric {
  id: string;
  label: string;
  model: string;
  fields: string[];
  filters: NonNullable<DataQuery['filters']>;
  tenantIds?: string[];
  aggregate?: { operation: 'sum'; field: string };
  currency?: string;
}

function utcStartOfDay(now: Date) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function utcStartOfMonth(now: Date) {
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export async function getPlatformMetrics(now = new Date()): Promise<PlatformMetric[]> {
  const today = utcStartOfDay(now);
  const month = utcStartOfMonth(now);
  const dateFilter = (value: string) => [{ field: 'createdAt', operator: 'gte' as const, value }];
  const definitions: PlatformMetric[] = [
    { id: 'companies-total', label: 'Companies Total', model: 'Tenant', fields: ['id', 'name', 'isActive', 'createdAt'], filters: [] },
    { id: 'companies-active', label: 'Companies Active', model: 'Tenant', fields: ['id', 'name', 'isActive', 'createdAt'], filters: [{ field: 'isActive', operator: 'equals', value: true }] },
    { id: 'companies-created-today', label: 'Companies Created Today', model: 'Tenant', fields: ['id', 'name', 'isActive', 'createdAt'], filters: dateFilter(today) },
    { id: 'companies-created-this-month', label: 'Companies Created This Month', model: 'Tenant', fields: ['id', 'name', 'isActive', 'createdAt'], filters: dateFilter(month) },
    { id: 'users-total', label: 'Users Total', model: 'User', fields: ['id', 'isActive', 'createdAt'], filters: [] },
    { id: 'users-active', label: 'Users Active', model: 'User', fields: ['id', 'isActive', 'createdAt'], filters: [{ field: 'isActive', operator: 'equals', value: true }] },
    { id: 'users-created-today', label: 'Users Created Today', model: 'User', fields: ['id', 'isActive', 'createdAt'], filters: dateFilter(today) },
    { id: 'users-created-this-month', label: 'Users Created This Month', model: 'User', fields: ['id', 'isActive', 'createdAt'], filters: dateFilter(month) },
    { id: 'leads-total', label: 'Leads Total', model: 'Lead', fields: ['id', 'leadNumber', 'source', 'status', 'ownerId', 'projectId', 'createdAt'], filters: [] },
    { id: 'leads-created-today', label: 'Leads Created Today', model: 'Lead', fields: ['id', 'leadNumber', 'source', 'status', 'ownerId', 'projectId', 'createdAt'], filters: dateFilter(today) },
    { id: 'leads-created-this-month', label: 'Leads Created This Month', model: 'Lead', fields: ['id', 'leadNumber', 'source', 'status', 'ownerId', 'projectId', 'createdAt'], filters: dateFilter(month) },
    { id: 'site-visits-total', label: 'Site Visits Total', model: 'SiteVisit', fields: ['id', 'siteVisitNumber', 'status', 'scheduledAt', 'projectId', 'assigneeId', 'createdAt'], filters: [] },
    { id: 'projects-total', label: 'Projects Total', model: 'Project', fields: ['id', 'name', 'isActive', 'createdAt'], filters: [] },
    { id: 'units-total', label: 'Units Total', model: 'Unit', fields: ['id', 'unitCode', 'status', 'projectId', 'createdAt'], filters: [] },
    { id: 'quotations-total', label: 'Quotations Total', model: 'Quotation', fields: ['id', 'quotationNumber', 'status', 'projectId', 'unitId', 'totalPrice', 'createdAt'], filters: [] },
    { id: 'bookings-total', label: 'Bookings Total', model: 'Booking', fields: ['id', 'bookingNumber', 'status', 'bookingStage', 'projectId', 'unitId', 'bookingAmount', 'createdAt'], filters: [] },
    { id: 'receipts-total', label: 'Receipts Total', model: 'Receipt', fields: ['id', 'receiptNumber', 'kind', 'approvalStatus', 'amount', 'receiptDate', 'createdAt'], filters: [] },
  ];

  const paymentRows = await withPlatformReadOnly(async (client) => {
    const tenants = await client.tenant.findMany({
      select: { id: true, name: true, currency: true },
      orderBy: { name: 'asc' },
    });
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const rows = await client.receipt.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenants.map((tenant) => tenant.id) },
        kind: 'CRM_PAYMENT',
        approvalStatus: { in: ['APPROVED', 'ISSUED'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const byCurrency = new Map<string, { tenantIds: string[]; tenantNames: string[] }>();
    rows.forEach((row) => {
      const tenant = tenantById.get(row.tenantId);
      if (!tenant) return;
      const currency = tenant.currency || 'UNSPECIFIED';
      const group = byCurrency.get(currency) || { tenantIds: [], tenantNames: [] };
      group.tenantIds.push(tenant.id);
      group.tenantNames.push(tenant.name);
      byCurrency.set(currency, group);
    });
    return [...byCurrency.entries()].map(([currency, group]) => ({ currency, ...group }));
  });
  for (const payment of paymentRows) {
    const currency = payment.currency;
    const tenantLabel = payment.tenantNames.length === 1
      ? payment.tenantNames[0]
      : 'all companies';
    const currencyFilter = currency === 'UNSPECIFIED'
      ? { field: 'tenant.currency', operator: 'isNull' as const, value: true }
      : { field: 'tenant.currency', operator: 'equals' as const, value: currency };
    definitions.push({
      id: `approved-payments-${currency.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
      label: `Approved payments (${tenantLabel}, ${currency})`,
      model: 'Receipt',
      fields: ['id', 'receiptNumber', 'approvalStatus', 'amount', 'receiptDate', 'createdAt'],
      filters: [
        { field: 'kind', operator: 'equals', value: 'CRM_PAYMENT' },
        { field: 'approvalStatus', operator: 'in', value: ['APPROVED', 'ISSUED'] },
        currencyFilter,
      ],
      tenantIds: payment.tenantIds,
      aggregate: { operation: 'sum', field: 'amount' },
      currency,
    });
  }
  return definitions;
}
