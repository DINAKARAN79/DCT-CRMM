import { prisma } from '@dct-crm/db';
import { Prisma } from '@prisma/client';
import {
  findSafeField,
  findSafeModel,
  findSafeRelation,
  SafeField,
  SafeModel,
} from './registry';

export type FilterOperator =
  | 'equals' | 'not' | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull';

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface ReportAggregate {
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;
  as?: string;
}

export interface DataQuery {
  model: string;
  tenantIds?: string[];
  fields?: string[];
  filters?: ReportFilter[];
  filterLogic?: 'AND' | 'OR';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  groupBy?: string[];
  aggregates?: ReportAggregate[];
  search?: { fields: string[]; value: string };
  includeTenantId?: boolean;
}

export interface TenantScope {
  mode: 'all' | 'selected';
  tenantIds: string[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PAGE_SIZE = 200;
const MAX_GROUP_COUNT_SCAN = 10_000;

type QueryClient = typeof prisma | Prisma.TransactionClient;

export async function withPlatformReadOnly<T>(
  operation: (client: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (client) => {
    await client.$executeRaw`SET TRANSACTION READ ONLY`;
    await client.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
    return operation(client);
  }, { maxWait: 1000, timeout: 6000 });
}

export function platformQueryService(input: DataQuery) {
  return withPlatformReadOnly((client) => executeDataQuery(input, client));
}

export async function resolveTenantScope(tenantIds?: string[], client: QueryClient = prisma): Promise<TenantScope> {
  if (tenantIds !== undefined) {
    if (!tenantIds.length || tenantIds.length > 500 || tenantIds.some((id) => !SAFE_ID.test(id))) {
      throw new ReportingError('Invalid tenant scope', 400);
    }
    const requested = [...new Set(tenantIds)];
    const existing = await client.tenant.findMany({
      where: { id: { in: requested } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((tenant) => tenant.id));
    if (existingIds.size !== requested.length) {
      throw new ReportingError('One or more tenant IDs do not exist', 400);
    }
    return { mode: 'selected', tenantIds: requested };
  }

  const tenants = await client.tenant.findMany({ select: { id: true } });
  return { mode: 'all', tenantIds: tenants.map((tenant) => tenant.id) };
}

export class ReportingError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'INVALID_REPORT_QUERY') {
    super(message);
    this.name = 'ReportingError';
  }
}

function assertSafeModel(modelName: string): SafeModel {
  const model = findSafeModel(modelName);
  if (!model) throw new ReportingError('Unknown or restricted model');
  return model;
}

function parseValue(field: SafeField, value: unknown): unknown {
  if (field.kind === 'enum') {
    if (typeof value !== 'string' || !field.enumValues?.includes(value)) {
      throw new ReportingError(`Invalid value for ${field.name}`);
    }
    return value;
  }
  switch (field.type) {
    case 'String':
      if (typeof value !== 'string' || value.length > 500) throw new ReportingError(`Invalid value for ${field.name}`);
      return value;
    case 'Boolean':
      if (typeof value !== 'boolean') throw new ReportingError(`Invalid value for ${field.name}`);
      return value;
    case 'Int':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new ReportingError(`Invalid value for ${field.name}`);
      return value;
    case 'Float':
    case 'Decimal':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ReportingError(`Invalid value for ${field.name}`);
      return value;
    case 'DateTime': {
      const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
      if (!date || Number.isNaN(date.getTime())) throw new ReportingError(`Invalid date value for ${field.name}`);
      return date;
    }
    default:
      throw new ReportingError(`Unsupported field type: ${field.type}`);
  }
}

function buildOperator(field: SafeField, operator: FilterOperator, value: unknown): Record<string, unknown> {
  if (operator === 'isNull') {
    if (typeof value !== 'boolean' || !field.nullable) throw new ReportingError(`Null filter is not valid for ${field.name}`);
    return value ? { equals: null } : { not: null };
  }
  if (operator === 'in' || operator === 'notIn') {
    if (!Array.isArray(value) || value.length > 200) throw new ReportingError(`Invalid list filter for ${field.name}`);
    const values = value.map((entry) => parseValue(field, entry));
    return { [operator]: values };
  }
  if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
    if (field.kind !== 'scalar' || field.type !== 'String') throw new ReportingError(`${operator} requires a text field`);
    const parsed = parseValue(field, value);
    return { [operator]: parsed, mode: 'insensitive' };
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(operator)
    && !['Int', 'Float', 'Decimal', 'DateTime'].includes(field.type)) {
    throw new ReportingError(`${operator} is not valid for ${field.name}`);
  }
  const parsed = parseValue(field, value);
  if (operator === 'not') return { not: parsed };
  return { [operator === 'equals' ? 'equals' : operator]: parsed };
}

function buildWhere(
  model: SafeModel,
  scope: TenantScope,
  filters: ReportFilter[] = [],
  filterLogic: 'AND' | 'OR' = 'AND',
  search?: DataQuery['search'],
): Record<string, unknown> {
  const scopeClauses: Record<string, unknown>[] = [];
  if (model.scope === 'tenant') {
    scopeClauses.push({ tenantId: { in: scope.tenantIds } });
  } else if (model.name === 'Tenant') {
    scopeClauses.push({ id: { in: scope.tenantIds } });
  }

  const filterClauses: Record<string, unknown>[] = [];
  for (const filter of filters) {
    const parts = filter.field.split('.');
    if (parts.length === 1) {
      const field = findSafeField(model, parts[0]);
      if (!field) throw new ReportingError(`Field is not available for reporting: ${filter.field}`);
      filterClauses.push({ [field.name]: buildOperator(field, filter.operator, filter.value) });
      continue;
    }
    if (parts.length !== 2 || model.scope !== 'tenant') {
      throw new ReportingError(`Relation filter is not available: ${filter.field}`);
    }
    const relation = findSafeRelation(model, parts[0]);
    const relatedField = relation?.fields.find((field) => field.name === parts[1]);
    if (!relation || !relatedField) throw new ReportingError(`Relation field is not available: ${filter.field}`);
    filterClauses.push({
      [relation.name]: {
        is: {
          ...(relation.target === 'Tenant'
            ? { id: { in: scope.tenantIds } }
            : { tenantId: { in: scope.tenantIds } }),
          [relatedField.name]: buildOperator(relatedField, filter.operator, filter.value),
        },
      },
    });
  }
  const filterClause = filterClauses.length === 0
    ? undefined
    : filterLogic === 'OR'
      ? { OR: filterClauses }
      : { AND: filterClauses };
  const searchClause = search?.value
    ? {
        OR: [...new Set(search.fields)].map((fieldName) => {
          const field = findSafeField(model, fieldName);
          if (!field || field.kind !== 'scalar' || field.type !== 'String') {
            throw new ReportingError(`Search is not available for field: ${fieldName}`);
          }
          return { [field.name]: { contains: search.value, mode: 'insensitive' } };
        }),
      }
    : undefined;
  const clauses = [
    ...scopeClauses,
    ...(filterClause ? [filterClause] : []),
    ...(searchClause ? [searchClause] : []),
  ];
  return clauses.length ? { AND: clauses } : {};
}

function aggregatePlan(model: SafeModel, aggregates: ReportAggregate[]) {
  if (!aggregates.length || aggregates.length > 8) throw new ReportingError('Provide between 1 and 8 aggregate values');
  const plan: Record<string, unknown> = {};
  const outputNames = new Set<string>();
  const fields: Record<string, Record<string, boolean>> = {};
  let countAll = false;
  const output = aggregates.map((aggregate) => {
    let field: SafeField | undefined;
    if (aggregate.operation === 'count' && !aggregate.field) {
      countAll = true;
    } else {
      if (!aggregate.field) throw new ReportingError(`${aggregate.operation} requires a field`);
      field = findSafeField(model, aggregate.field);
      if (!field) throw new ReportingError(`Field is not available for aggregation: ${aggregate.field}`);
      if (['sum', 'avg'].includes(aggregate.operation)
        && !['Int', 'Float', 'Decimal'].includes(field.type)) {
        throw new ReportingError(`${aggregate.operation} requires a numeric field`);
      }
    }
    const key = aggregate.as || `${aggregate.operation}${field ? `_${field.name}` : ''}`;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || outputNames.has(key)) {
      throw new ReportingError('Aggregate names must be unique and valid');
    }
    outputNames.add(key);
    if (field) {
      const slot = aggregate.operation === 'count' ? '_count' : `_${aggregate.operation}`;
      fields[slot] ||= {};
      fields[slot][field.name] = true;
    }
    return { key, operation: aggregate.operation, field: field?.name };
  });
  if (countAll) {
    fields._count ||= {};
    fields._count._all = true;
  }
  Object.entries(fields).forEach(([key, value]) => { plan[key] = value; });
  return { plan, output };
}

export async function executeDataQuery(input: DataQuery, client: QueryClient = prisma) {
  const model = assertSafeModel(input.model);
  const scope = await resolveTenantScope(input.tenantIds, client);
  const where = buildWhere(model, scope, input.filters, input.filterLogic, input.search);
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(
    input.groupBy?.length ? MAX_GROUP_COUNT_SCAN : MAX_PAGE_SIZE,
    Math.max(1, input.pageSize || 50),
  );
  const delegate = (client as any)[model.name[0].toLowerCase() + model.name.slice(1)];
  if (!delegate) throw new ReportingError('Reporting model is unavailable', 500);

  if (!input.groupBy?.length && input.aggregates?.length) {
    const { plan, output } = aggregatePlan(model, input.aggregates);
    const [values, totalRecords] = await Promise.all([
      delegate.aggregate({ where, ...plan }),
      delegate.count({ where }),
    ]);
    return {
      mode: 'aggregate' as const,
      model: model.name,
      scope,
      totalRecords,
      values: Object.fromEntries(output.map((entry) => [
        entry.key,
        entry.operation === 'count' && !entry.field
          ? values._count?._all
          : values[`_${entry.operation}`]?.[entry.field!],
      ])),
    };
  }

  if (input.groupBy?.length || input.aggregates?.length) {
    const groupBy = input.groupBy || [];
    if (!groupBy.length || groupBy.length > 4) throw new ReportingError('Grouped reports require 1 to 4 group fields');
    const uniqueGroups = [...new Set(groupBy)];
    if (uniqueGroups.length !== groupBy.length) throw new ReportingError('Group fields must be unique');
    uniqueGroups.forEach((name) => {
      if (name === 'tenant.name' || name === 'tenant.id') {
        if (model.scope !== 'tenant') throw new ReportingError(`Field is not available for grouping: ${name}`);
        return;
      }
      if (!findSafeField(model, name)) throw new ReportingError(`Field is not available for grouping: ${name}`);
    });
    if (input.sortBy && input.sortBy !== 'tenant.name' && input.sortBy !== 'tenant.id' && !findSafeField(model, input.sortBy)) {
      throw new ReportingError(`Field is not available for sorting: ${input.sortBy}`);
    }
    if (input.sortBy && !uniqueGroups.includes(input.sortBy)) {
      throw new ReportingError('Grouped reports can only sort by a group field');
    }
    const databaseGroupFields = [...new Set(uniqueGroups.map((field) =>
      field === 'tenant.name' || field === 'tenant.id' ? 'tenantId' : field,
    ))];
    const { plan, output } = aggregatePlan(model, input.aggregates || [{ operation: 'count' }]);
    const [groups, groupCountRows, totalRecords] = await Promise.all([
      delegate.groupBy({
        by: databaseGroupFields,
        where,
        ...plan,
        orderBy: input.sortBy
          ? { [input.sortBy === 'tenant.name' || input.sortBy === 'tenant.id' ? 'tenantId' : input.sortBy]: input.sortOrder || 'asc' }
          : { [databaseGroupFields[0]]: input.sortOrder || 'asc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      delegate.groupBy({
        by: databaseGroupFields,
        where,
        orderBy: databaseGroupFields.map((field) => ({ [field]: 'asc' })),
        take: MAX_GROUP_COUNT_SCAN + 1,
      }),
      delegate.count({ where }),
    ]);
    const tenantNames = new Map<string, string>();
    if (uniqueGroups.includes('tenant.name')) {
      const tenantIds: string[] = [...new Set<string>(
        groups.map((group: Record<string, unknown>) => String(group.tenantId)),
      )];
      const tenants = await client.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      });
      tenants.forEach((tenant) => tenantNames.set(tenant.id, tenant.name));
    }
    return {
      mode: 'grouped' as const,
      model: model.name,
      scope,
      page,
      pageSize,
      totalRecords,
      totalGroups: Math.min(groupCountRows.length, MAX_GROUP_COUNT_SCAN),
      totalGroupsTruncated: groupCountRows.length > MAX_GROUP_COUNT_SCAN,
      groups: groups.map((group: Record<string, any>) => {
        const values: Record<string, unknown> = {};
        output.forEach((entry) => {
          const value = entry.operation === 'count' && !entry.field
            ? group._count?._all
            : group[`_${entry.operation}`]?.[entry.field!];
          values[entry.key] = value ?? null;
        });
        return {
          by: Object.fromEntries(uniqueGroups.map((field) => [
            field,
            field === 'tenant.name'
              ? tenantNames.get(String(group.tenantId))
              : field === 'tenant.id' ? String(group.tenantId) : group[field],
          ])),
          values,
        };
      }),
    };
  }

  const safeFields = input.fields?.length
    ? [...new Set(input.fields)]
    : model.fields.slice(0, 40).map((field) => field.name);
  if (!safeFields.length || safeFields.length > 40) throw new ReportingError('Select between 1 and 40 fields');
  safeFields.forEach((name) => {
    if (!findSafeField(model, name)) throw new ReportingError(`Field is not available for selection: ${name}`);
  });
  if (input.search) {
    if (input.search.value.length > 100 || input.search.fields.length > 10) {
      throw new ReportingError('Search criteria are too broad');
    }
    input.search.fields.forEach((name) => {
      const field = findSafeField(model, name);
      if (!field || field.type !== 'String' || field.kind !== 'scalar') {
        throw new ReportingError(`Search is not available for field: ${name}`);
      }
    });
  }
  if (input.includeTenantId && model.scope === 'tenant' && !safeFields.includes('tenantId')) {
    safeFields.push('tenantId');
  }
  const sortBy = input.sortBy || (findSafeField(model, 'createdAt') ? 'createdAt' : model.fields[0]?.name);
  if (!sortBy) throw new ReportingError('This model has no reportable fields');
  const sortByTenantName = sortBy === 'tenant.name'
    && model.scope === 'tenant'
    && Boolean(findSafeRelation(model, 'tenant')?.fields.some((field) => field.name === 'name'));
  if (!findSafeField(model, sortBy) && !sortByTenantName) {
    throw new ReportingError(`Field is not available for sorting: ${sortBy}`);
  }
  const [total, records] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({
      where,
      select: Object.fromEntries(safeFields.map((field) => [field, true])),
      orderBy: sortByTenantName
        ? { tenant: { name: input.sortOrder || 'desc' } }
        : { [sortBy]: input.sortOrder || 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
  ]);
  return {
    mode: 'records' as const,
    model: model.name,
    scope,
    page,
    pageSize,
    total,
    records,
  };
}

export async function getPlatformOverview(tenantIds?: string[]) {
  return withPlatformReadOnly(async (client) => {
  const scope = await resolveTenantScope(tenantIds, client);
  const ids = scope.tenantIds;
  const tenantWhere = { tenantId: { in: ids } };
  const idWhere = { id: { in: ids } };
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const createdToday = { createdAt: { gte: start } };
  const createdThisMonth = { createdAt: { gte: monthStart } };
  const [activeCompanies, companiesToday, companiesMonth, users, activeUsers, usersToday, usersMonth, leads, leadsToday, leadsMonth, siteVisits, projects, units, quotations, bookings, bookingsToday, bookingsMonth, bookingSums, receipts, receiptSums, currencies] = await Promise.all([
    client.tenant.count({ where: { ...idWhere, isActive: true } }),
    client.tenant.count({ where: { ...idWhere, ...createdToday } }),
    client.tenant.count({ where: { ...idWhere, ...createdThisMonth } }),
    client.user.count({ where: tenantWhere }),
    client.user.count({ where: { ...tenantWhere, isActive: true } }),
    client.user.count({ where: { ...tenantWhere, ...createdToday } }),
    client.user.count({ where: { ...tenantWhere, ...createdThisMonth } }),
    client.lead.count({ where: tenantWhere }),
    client.lead.count({ where: { ...tenantWhere, ...createdToday } }),
    client.lead.count({ where: { ...tenantWhere, ...createdThisMonth } }),
    client.siteVisit.count({ where: tenantWhere }),
    client.project.count({ where: tenantWhere }),
    client.unit.count({ where: tenantWhere }),
    client.quotation.count({ where: tenantWhere }),
    client.booking.count({ where: tenantWhere }),
    client.booking.count({ where: { ...tenantWhere, ...createdToday } }),
    client.booking.count({ where: { ...tenantWhere, ...createdThisMonth } }),
    client.booking.groupBy({
      by: ['tenantId'],
      where: { ...tenantWhere, status: { in: ['BOOKED', 'CONFIRMED'] } },
      _sum: { bookingAmount: true },
      _count: { _all: true },
    }),
    client.receipt.count({ where: tenantWhere }),
    client.receipt.groupBy({
      by: ['tenantId'],
      where: {
        ...tenantWhere,
        kind: 'CRM_PAYMENT',
        approvalStatus: { in: ['APPROVED', 'ISSUED'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    client.tenant.findMany({ where: idWhere, select: { id: true, name: true, currency: true } }),
  ]);
  const tenantById = new Map(currencies.map((tenant) => [tenant.id, tenant]));
  const byCurrency = (rows: Array<{ tenantId: string; _sum: { bookingAmount?: number | null; amount?: number | null }; _count: { _all: number } }>, amountField: 'bookingAmount' | 'amount') =>
    rows.map((row) => ({
      tenantId: row.tenantId,
      tenantName: tenantById.get(row.tenantId)?.name,
      currency: tenantById.get(row.tenantId)?.currency || 'UNSPECIFIED',
      amount: row._sum[amountField] || 0,
      records: row._count._all,
    }));

  return {
    scope,
    companies: { total: ids.length, active: activeCompanies, createdToday: companiesToday, createdThisMonth: companiesMonth },
    users: { total: users, active: activeUsers, createdToday: usersToday, createdThisMonth: usersMonth },
    leads: { total: leads, createdToday: leadsToday, createdThisMonth: leadsMonth },
    siteVisits: { total: siteVisits },
    projects: { total: projects },
    units: { total: units },
    quotations: { total: quotations },
    bookings: {
      total: bookings,
      createdToday: bookingsToday,
      createdThisMonth: bookingsMonth,
      bookedConfirmedAmountByTenantCurrency: byCurrency(bookingSums, 'bookingAmount'),
      valueBasis: 'bookingAmount for BOOKED and CONFIRMED statuses only; this is not collected revenue.',
    },
    receipts: {
      total: receipts,
      approvedCrmPaymentsByTenantCurrency: byCurrency(receiptSums, 'amount'),
      valueBasis: 'CRM_PAYMENT receipts with APPROVED or ISSUED status; amounts are not combined across tenant currencies.',
    },
    period: { dayStartUtc: start.toISOString(), monthStartUtc: monthStart.toISOString() },
  };
  });
}
