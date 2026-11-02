import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/superAdmin';
import { getPlatformOverview, platformQueryService as executeDataQuery, withPlatformReadOnly, DataQuery, ReportingError, resolveTenantScope } from '../platformReporting/engine';
import { getPlatformRegistry } from '../platformReporting/registry';
import { getPlatformMetrics } from '../platformReporting/metrics';

const router = Router();
const filterSchema = z.object({
  field: z.string().min(1).max(128),
  operator: z.enum(['equals', 'not', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'isNull']),
  value: z.unknown().optional(),
}).strict();
const aggregateSchema = z.object({
  operation: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  field: z.string().min(1).max(128).optional(),
  as: z.string().min(1).max(64).optional(),
}).strict();
const querySchema = z.object({
  model: z.string().min(1).max(100),
  tenantIds: z.array(z.string().min(1).max(128)).min(1).max(500).optional(),
  fields: z.array(z.string().min(1).max(128)).min(1).max(40).optional(),
  filters: z.array(filterSchema).max(30).optional(),
  filterLogic: z.enum(['AND', 'OR']).optional(),
  sortBy: z.string().min(1).max(128).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  groupBy: z.array(z.string().min(1).max(128)).min(1).max(4).optional(),
  aggregates: z.array(aggregateSchema).min(1).max(8).optional(),
}).strict();
const reportInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  definition: querySchema,
}).strict();
const dashboardInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  definition: z.object({
    widgets: z.array(z.object({
      id: z.string().trim().min(1).max(80),
      title: z.string().trim().min(1).max(120),
      query: querySchema,
      width: z.number().int().min(1).max(12).optional(),
      height: z.number().int().min(1).max(8).optional(),
    }).strict()).max(20),
  }).strict(),
}).strict();
const dashboardRunSchema = z.object({
  scope: z.object({
    mode: z.enum(['all', 'selected']),
    tenantIds: z.array(z.string().min(1).max(128)).max(500),
  }).strict().optional(),
}).strict();
const metricParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value)).default(25),
  sort: z.string().max(128).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().max(100).optional(),
  companyIds: z.string().max(20_000).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  status: z.string().max(100).optional(),
  ownerId: z.string().max(128).optional(),
  projectId: z.string().max(128).optional(),
}).strict();
type DashboardWidgetResult =
  | { id: string; title: string; success: true; data: Awaited<ReturnType<typeof executeDataQuery>> }
  | { id: string; title: string; success: false; error: string };

router.use(authenticate, requireSuperAdmin);

function respondError(res: Response, error: unknown) {
  if (error instanceof ReportingError) {
    return res.status(error.status).json({ success: false, error: error.message, code: error.code });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, error: 'Invalid request', details: error.issues });
  }
  const message = error instanceof Error ? error.message : 'Reporting operation failed';
  if (message === 'Record not found') return res.status(404).json({ success: false, error: message });
  console.error('Platform reporting error:', error);
  return res.status(500).json({ success: false, error: 'Platform reporting operation failed' });
}

function parseTenantIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  const parsed = z.array(z.string().min(1).max(128)).min(1).max(500).safeParse(raw);
  if (parsed.success) return parsed.data;
  if (typeof raw === 'string') {
    const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
    const fromString = z.array(z.string().min(1).max(128)).min(1).max(500).safeParse(values);
    if (fromString.success) return fromString.data;
  }
  throw new ReportingError('tenantIds must contain between 1 and 500 tenant IDs');
}

async function writeExecutionAudit(input: {
  actorId: string;
  operation: string;
  targetType: string;
  targetId?: string;
  tenantIds?: string[];
  resultCount?: number;
  succeeded?: boolean;
  errorCode?: string;
  filters?: Record<string, unknown>;
  durationMs?: number;
}) {
  await prisma.platformReportExecutionAudit.create({
    data: {
      actorId: input.actorId,
      operation: input.operation,
      targetType: input.targetType,
      targetId: input.targetId,
      tenantIds: input.tenantIds,
      resultCount: input.resultCount,
      filters: input.filters as any,
      durationMs: input.durationMs,
      succeeded: input.succeeded ?? true,
      errorCode: input.errorCode,
    },
  });
}

function jsonDefinition(value: unknown): any {
  return value;
}

async function executeAudited(query: DataQuery, actorId: string, operation: string, targetId?: string) {
  try {
    const result = await executeDataQuery(query);
    const count = result.mode === 'records' ? result.records.length : result.groups.length;
    await writeExecutionAudit({
      actorId,
      operation,
      targetType: 'query',
      targetId,
      tenantIds: result.scope.tenantIds,
      resultCount: count,
    });
    return result;
  } catch (error) {
    try {
      await writeExecutionAudit({
        actorId,
        operation,
        targetType: 'query',
        targetId,
        tenantIds: query.tenantIds,
        succeeded: false,
        errorCode: error instanceof ReportingError ? error.code : 'QUERY_FAILED',
      });
    } catch (auditError) {
      console.error('Platform reporting failure audit could not be written:', auditError);
    }
    throw error;
  }
}

router.get('/overview', async (req: AuthRequest, res: Response) => {
  try {
    const overview = await getPlatformOverview(parseTenantIds(req.query.tenantIds));
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'overview',
      targetType: 'overview',
      tenantIds: overview.scope.tenantIds,
    });
    res.json({ success: true, data: overview });
  } catch (error) {
    respondError(res, error);
  }
});

const metricCache = new Map<string, { metric: Awaited<ReturnType<typeof getPlatformMetrics>>[number]; expiresAt: number }>();
const metricsCacheExpires = { value: 0 };
type MetricCardSnapshot = {
  id: string;
  label: string;
  value: number;
  recordCount: number;
  currency?: string;
};
let metricCardSnapshot: { expiresAt: number; asOf: string; cards: MetricCardSnapshot[] } | null = null;
async function metricDefinitions() {
  if (Date.now() >= metricsCacheExpires.value) {
    const metrics = await getPlatformMetrics();
    metricCache.clear();
    metrics.forEach((metric) => metricCache.set(metric.id, { metric, expiresAt: Date.now() + 60_000 }));
    metricsCacheExpires.value = Date.now() + 60_000;
  }
  return [...metricCache.values()].map(({ metric }) => metric);
}
async function findMetric(metricId: string) {
  const metrics = await metricDefinitions();
  return metrics.find((metric) => metric.id === metricId);
}
async function getMetricCardSnapshot() {
  if (metricCardSnapshot && metricCardSnapshot.expiresAt > Date.now()) return metricCardSnapshot;
  const definitions = await metricDefinitions();
  const cards = await Promise.all(definitions.map(async (metric): Promise<MetricCardSnapshot> => {
    const base = { ...metricQuery(metric), page: 1, pageSize: 1 };
    if (metric.aggregate) {
      const [count, sum] = await Promise.all([
        executeDataQuery(base),
        executeDataQuery({ ...base, aggregates: [metric.aggregate] }),
      ]);
      const value = sum && !Array.isArray(sum) && sum.mode === 'aggregate'
        ? Number(sum.values[`sum_${metric.aggregate.field}`] || 0)
        : 0;
      return {
        id: metric.id,
        label: metric.label,
        value,
        recordCount: count && !Array.isArray(count) && count.mode === 'records' ? count.total : 0,
        currency: metric.currency,
      };
    }
    const result = await executeDataQuery(base);
    const count = result && !Array.isArray(result) && result.mode === 'records' ? result.total : 0;
    return { id: metric.id, label: metric.label, value: count, recordCount: count };
  }));
  metricCardSnapshot = { expiresAt: Date.now() + 60_000, asOf: new Date().toISOString(), cards };
  return metricCardSnapshot;
}
function metricQuery(
  metric: NonNullable<Awaited<ReturnType<typeof findMetric>>>,
  params?: z.infer<typeof metricParamsSchema>,
) {
  const companyIds = params?.companyIds
    ? [...new Set(params.companyIds.split(',').map((id) => id.trim()).filter(Boolean))]
    : undefined;
  if (companyIds && (!companyIds.length || companyIds.length > 500 || companyIds.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)))) {
    throw new ReportingError('Invalid company filter');
  }
  const selectedMetricTenants = metric.tenantIds && companyIds
    ? companyIds.filter((id) => metric.tenantIds!.includes(id))
    : undefined;
  const tenantIds = metric.tenantIds
    ? selectedMetricTenants?.length ? selectedMetricTenants : metric.tenantIds
    : companyIds;
  const pageSize = params?.pageSize || 25;
  const page = params?.page || 1;
  if ((page - 1) * pageSize >= 50_000) {
    throw new ReportingError('This page exceeds the 50,000-row report limit. Narrow your filters.', 400, 'ROW_LIMIT');
  }
  const filters = (params?.dateFrom || params?.dateTo)
    ? metric.filters.filter((filter) => filter.field !== 'createdAt')
    : [...metric.filters];
  if (metric.tenantIds && companyIds && !selectedMetricTenants?.length) {
    filters.push({ field: 'id', operator: 'equals', value: '__no_company_scope__' });
  }
  if (params?.dateFrom || params?.dateTo) {
    if (!metric.fields.includes('createdAt')) throw new ReportingError('Date filtering is not available for this metric');
    if (params.dateFrom) filters.push({ field: 'createdAt', operator: 'gte', value: params.dateFrom });
    if (params.dateTo) filters.push({ field: 'createdAt', operator: 'lte', value: params.dateTo });
  }
  if (params?.status) {
    const statusField = metric.fields.includes('status')
      ? 'status'
      : metric.fields.includes('approvalStatus') ? 'approvalStatus' : undefined;
    if (!statusField) throw new ReportingError('Status filtering is not available for this metric');
    filters.push({ field: statusField, operator: 'equals', value: params.status });
  }
  if (params?.ownerId) {
    const ownerField = metric.fields.includes('ownerId')
      ? 'ownerId'
      : metric.fields.includes('assigneeId') ? 'assigneeId' : undefined;
    if (!ownerField) throw new ReportingError('Owner filtering is not available for this metric');
    filters.push({ field: ownerField, operator: 'equals', value: params.ownerId });
  }
  if (params?.projectId) {
    if (!metric.fields.includes('projectId')) throw new ReportingError('Project filtering is not available for this metric');
    filters.push({ field: 'projectId', operator: 'equals', value: params.projectId });
  }
  const requestedSort = params?.sort || metric.fields.find((field) => field === 'createdAt') || metric.fields[0];
  const sortBy = requestedSort === 'company'
    ? metric.model === 'Tenant' ? 'name' : 'tenant.name'
    : requestedSort;
  if (sortBy !== 'tenant.name' && !metric.fields.includes(sortBy)) throw new ReportingError('Unsupported sort field');
  const searchFields = metric.fields.filter((field) => ['id', 'name', 'leadNumber', 'siteVisitNumber', 'quotationNumber', 'bookingNumber', 'receiptNumber', 'unitCode'].includes(field));
  return {
    model: metric.model,
    tenantIds,
    fields: metric.fields,
    filters,
    sortBy,
    sortOrder: params?.order || 'desc',
    page,
    pageSize,
    search: params?.search && searchFields.length ? { fields: searchFields, value: params.search } : undefined,
    includeTenantId: metric.model !== 'Tenant',
  } satisfies DataQuery;
}

router.get('/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const snapshot = await getMetricCardSnapshot();
    res.json({ success: true, data: { cards: snapshot.cards, asOf: snapshot.asOf } });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/metrics/:metricId/summary', async (req: AuthRequest, res: Response) => {
  const parsed = metricParamsSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid report filters' });
  try {
    const metric = await findMetric(req.params.metricId);
    if (!metric) return res.status(404).json({ success: false, error: 'Metric not found' });
    const startedAt = Date.now();
    const query = metricQuery(metric, parsed.data);
    const countResult = await executeDataQuery({ ...query, page: 1, pageSize: 1 });
    const defaultView = !['search', 'companyIds', 'dateFrom', 'dateTo', 'status', 'ownerId', 'projectId', 'sort'].some((key) => req.query[key] !== undefined);
    const snapshot = defaultView ? await getMetricCardSnapshot() : null;
    const card = snapshot?.cards.find((entry) => entry.id === metric.id);
    const total = card?.recordCount ?? (countResult.mode === 'records' ? countResult.total : 0);
    const aggregateResult = metric.aggregate
      ? await executeDataQuery({ ...query, aggregates: [metric.aggregate] })
      : null;
    const byCompany = metric.model === 'Tenant'
      ? null
      : await executeDataQuery({
        ...query,
        sortBy: undefined,
        groupBy: ['tenant.id', 'tenant.name'],
        aggregates: [{ operation: 'count' }, ...(metric.aggregate ? [metric.aggregate] : [])],
        page: 1,
        pageSize: 10_000,
      });
    const companyGroups = byCompany && !Array.isArray(byCompany) && byCompany.mode === 'grouped'
      ? byCompany as { groups: Array<{ by: Record<string, unknown>; values: Record<string, unknown> }>; totalGroupsTruncated: boolean }
      : null;
    const statusField = metric.fields.includes('status') ? 'status' : metric.fields.includes('approvalStatus') ? 'approvalStatus' : undefined;
    const byStatus = statusField
      ? await executeDataQuery({
        ...query,
        sortBy: undefined,
        groupBy: ['tenant.id', 'tenant.name', statusField],
        aggregates: [{ operation: 'count' }],
        page: 1,
        pageSize: 10_000,
      })
      : null;
    const statusGroups = byStatus && !Array.isArray(byStatus) && byStatus.mode === 'grouped'
      ? byStatus as { groups: Array<{ by: Record<string, unknown>; values: Record<string, unknown> }> }
      : null;
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'open-metric-report',
      targetType: 'metric',
      targetId: metric.id,
      tenantIds: countResult.scope.tenantIds,
      resultCount: total,
      filters: parsed.data as Record<string, unknown>,
      durationMs: Date.now() - startedAt,
    });
    res.json({ success: true, data: {
      id: metric.id,
      label: metric.label,
      model: metric.model,
      total,
      value: card?.value ?? (aggregateResult?.mode === 'aggregate'
        ? Number(aggregateResult.values[`sum_${metric.aggregate!.field}`] || 0)
        : total),
      currency: metric.currency,
      fields: metric.fields,
      defaultFilters: metric.filters,
      defaultTenantIds: metric.tenantIds,
      supportsOwnerFilter: metric.fields.includes('ownerId') || metric.fields.includes('assigneeId'),
      supportsProjectFilter: metric.fields.includes('projectId'),
      companyBreakdown: companyGroups
        ? companyGroups.groups.map((group) => ({
          companyId: String(group.by['tenant.id'] || ''),
          company: String(group.by['tenant.name'] || 'Unknown company'),
          count: Number(group.values.count || 0),
          ...(metric.aggregate
            ? { value: Number(group.values[`sum_${metric.aggregate.field}`] || 0) }
            : {}),
        }))
        : [],
      companyBreakdownTruncated: companyGroups?.totalGroupsTruncated ?? false,
      statusBreakdown: statusGroups
        ? statusGroups.groups.map((group) => ({
          companyId: String(group.by['tenant.id'] || ''),
          company: String(group.by['tenant.name'] || 'Unknown company'),
          status: String(group.by[statusField!] || 'Unspecified'),
          count: Number(group.values.count || 0),
        }))
        : [],
      asOf: snapshot?.asOf || new Date().toISOString(),
    } });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/metrics/:metricId/records', async (req: AuthRequest, res: Response) => {
  const parsed = metricParamsSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid report filters' });
  try {
    const metric = await findMetric(req.params.metricId);
    if (!metric) return res.status(404).json({ success: false, error: 'Metric not found' });
    const startedAt = Date.now();
    const query = metricQuery(metric, parsed.data);
    const result = await executeDataQuery(query);
    if (Array.isArray(result) || result.mode !== 'records') throw new ReportingError('Metric records are unavailable', 500);
    const tenantIds: string[] = metric.model === 'Tenant'
      ? result.records.map((record: Record<string, unknown>) => String(record.id))
      : result.records.map((record: Record<string, unknown>) => String(record.tenantId || '')).filter(Boolean);
    const companies = await withPlatformReadOnly((client) => client.tenant.findMany({
      where: { id: { in: [...new Set(tenantIds)] } },
      select: { id: true, name: true, currency: true },
    }));
    const companyNames = new Map(companies.map((company) => [company.id, company.name]));
    const records = result.records.map((record: Record<string, unknown>) => {
      const tenantId = record.tenantId;
      const safeRecord = Object.fromEntries(metric.fields.map((field) => [field, record[field]]));
      return {
        ...safeRecord,
        company: metric.model === 'Tenant'
          ? String(record.name || '—')
          : companyNames.get(String(tenantId)) || '—',
      };
    });
    const defaultView = !['search', 'companyIds', 'dateFrom', 'dateTo', 'status', 'ownerId', 'projectId', 'sort'].some((key) => req.query[key] !== undefined);
    const snapshot = defaultView ? await getMetricCardSnapshot() : null;
    const card = snapshot?.cards.find((entry) => entry.id === metric.id);
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'view-metric-records',
      targetType: 'metric',
      targetId: metric.id,
      tenantIds: result.scope.tenantIds,
      resultCount: records.length,
      filters: parsed.data as Record<string, unknown>,
      durationMs: Date.now() - startedAt,
    });
    res.json({ success: true, data: {
      id: metric.id,
      records,
      total: card?.recordCount ?? result.total,
      page: result.page,
      pageSize: result.pageSize,
      capped: (card?.recordCount ?? result.total) > 50_000,
      currency: metric.currency,
      asOf: snapshot?.asOf || new Date().toISOString(),
    } });
  } catch (error) {
    respondError(res, error);
  }
});

async function exportMetric(
  req: AuthRequest,
  res: Response,
  format: 'csv' | 'xlsx',
) {
  const parsed = metricParamsSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid report filters' });
  const startedAt = Date.now();
  try {
    const metric = await findMetric(req.params.metricId);
    if (!metric) return res.status(404).json({ success: false, error: 'Metric not found' });
    const query = metricQuery(metric, { ...parsed.data, page: 1, pageSize: 200 });
    const first = await executeDataQuery(query);
    if (first.mode !== 'records') throw new ReportingError('Metric records are unavailable', 500);
    const limit = Math.min(first.total, 100_000);
    const allRecords = [...first.records];
    for (let page = 2; allRecords.length < limit; page += 1) {
      const next = await executeDataQuery({ ...query, page });
      if (next.mode !== 'records' || !next.records.length) break;
      allRecords.push(...next.records.slice(0, limit - allRecords.length));
    }
    const companies = await withPlatformReadOnly((client) => client.tenant.findMany({
      where: { id: { in: [...new Set(allRecords.map((record) => String(record.tenantId || '')).filter(Boolean))] } },
      select: { id: true, name: true },
    }));
    const companyNames = new Map(companies.map((company) => [company.id, company.name]));
    const rows: Array<Record<string, unknown>> = allRecords.map((record) => {
      const tenantId = record.tenantId;
      const safeRecord = Object.fromEntries(metric.fields.map((field) => [field, record[field]]));
      return { ...safeRecord, company: metric.model === 'Tenant' ? String(record.name || '—') : companyNames.get(String(tenantId)) || '—' };
    });
    const columns = [...new Set(['company', ...Object.keys(rows[0] || {}).filter((field) => field !== 'company')])];
    if (format === 'csv') {
      const csvValue = (value: unknown) => {
        const text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value);
        const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = [
        columns.map(csvValue).join(','),
        ...rows.map((row) => columns.map((field) => csvValue(row[field])).join(',')),
      ].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="platform-${metric.id}.csv"`);
      res.setHeader('X-Export-Truncated', first.total > limit ? 'true' : 'false');
      await writeExecutionAudit({
        actorId: req.user!.id,
        operation: 'export-metric-csv',
        targetType: 'metric',
        targetId: metric.id,
        tenantIds: first.scope.tenantIds,
        resultCount: rows.length,
        filters: parsed.data as Record<string, unknown>,
        durationMs: Date.now() - startedAt,
      });
      return res.send(csv);
    }
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Platform report');
    sheet.columns = columns.map((key) => ({ header: key, key, width: Math.min(40, Math.max(12, key.length + 2)) }));
    rows.forEach((row) => {
      const safeRow = Object.fromEntries(columns.map((column) => {
        const value = row[column];
        const safeValue = typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)
          ? `'${value}`
          : value;
        return [column, safeValue];
      }));
      sheet.addRow(safeRow);
    });
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="platform-${metric.id}.xlsx"`);
    res.setHeader('X-Export-Truncated', first.total > limit ? 'true' : 'false');
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'export-metric-xlsx',
      targetType: 'metric',
      targetId: metric.id,
      tenantIds: first.scope.tenantIds,
      resultCount: rows.length,
      filters: parsed.data as Record<string, unknown>,
      durationMs: Date.now() - startedAt,
    });
    return res.send(Buffer.from(buffer));
  } catch (error) {
    try {
      await writeExecutionAudit({
        actorId: req.user!.id,
        operation: `export-metric-${format}`,
        targetType: 'metric',
        targetId: req.params.metricId,
        resultCount: 0,
        filters: parsed.data as Record<string, unknown>,
        durationMs: Date.now() - startedAt,
        succeeded: false,
        errorCode: error instanceof ReportingError ? error.code : 'EXPORT_FAILED',
      });
    } catch (auditError) {
      console.error('Platform metric export failure audit could not be written:', auditError);
    }
    respondError(res, error);
  }
}

router.get('/metrics/:metricId/export.csv', (req: AuthRequest, res: Response) => exportMetric(req, res, 'csv'));
router.get('/metrics/:metricId/export.xlsx', (req: AuthRequest, res: Response) => exportMetric(req, res, 'xlsx'));

router.get('/registry', (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      models: getPlatformRegistry(),
      operators: ['equals', 'not', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'isNull'],
      aggregateOperations: ['count', 'sum', 'avg', 'min', 'max'],
      maxPageSize: 200,
      maxExportRows: 5000,
    },
  });
});

router.get('/tenants', async (req: AuthRequest, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const where: any = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { companyCode: { contains: search, mode: 'insensitive' } },
      ],
    } : {};
    const [total, items] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          companyCode: true,
          currency: true,
          isActive: true,
          packageName: true,
          createdAt: true,
        },
        orderBy: { name: 'asc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
    ]);
    await writeExecutionAudit({ actorId: req.user!.id, operation: 'list-tenants', targetType: 'tenant', resultCount: items.length });
    res.json({ success: true, data: { items, total, page, pageSize } });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/tenant-analytics', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await resolveTenantScope(parseTenantIds(req.query.tenantIds));
    const [tenants, leadCounts] = await Promise.all([
      prisma.tenant.findMany({
        where: { id: { in: scope.tenantIds } },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      prisma.lead.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: scope.tenantIds } },
        _count: { _all: true },
      }),
    ]);
    const countsByTenant = new Map(leadCounts.map((entry) => [entry.tenantId, entry._count._all]));
    const items = tenants.map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      isActive: tenant.isActive,
      leadCount: countsByTenant.get(tenant.id) || 0,
    }));
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'tenant-analytics',
      targetType: 'tenant',
      tenantIds: scope.tenantIds,
      resultCount: items.length,
    });
    res.json({ success: true, data: { scope, items } });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/query', async (req: AuthRequest, res: Response) => {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid query', details: parsed.error.issues });
  try {
    const data = await executeAudited(parsed.data, req.user!.id, 'query');
    res.json({ success: true, data });
  } catch (error) {
    respondError(res, error);
  }
});

const reports = prisma.platformReportDefinition as any;
const dashboards = prisma.platformDashboardDefinition as any;

router.get('/reports', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
    const [total, items] = await Promise.all([
      reports.count({ where }),
      reports.findMany({ where, orderBy: { updatedAt: 'desc' }, take: pageSize, skip: (page - 1) * pageSize }),
    ]);
    res.json({ success: true, data: { items, total, page, pageSize } });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/reports', async (req: AuthRequest, res: Response) => {
  const parsed = reportInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid report definition', details: parsed.error.issues });
  try {
    const item = await reports.create({
      data: { ...parsed.data, definition: jsonDefinition(parsed.data.definition), createdBy: req.user!.id, updatedBy: req.user!.id },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/reports/:id/export.csv', async (req: AuthRequest, res: Response) => {
  try {
    const report = await reports.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ success: false, error: 'Record not found' });
    const parsed = querySchema.safeParse(report.definition);
    if (!parsed.success || parsed.data.groupBy?.length || parsed.data.aggregates?.length) {
      return res.status(400).json({ success: false, error: 'CSV export supports saved record reports only' });
    }
    const first = await executeAudited({ ...parsed.data, page: 1, pageSize: 200 }, req.user!.id, 'export', report.id);
    if (first.mode !== 'records') return res.status(400).json({ success: false, error: 'CSV export supports saved record reports only' });
    const allRecords = [...first.records];
    const exportLimit = Math.min(first.total, 5000);
    for (let page = 2; allRecords.length < exportLimit; page += 1) {
      const next = await executeDataQuery({ ...parsed.data, page, pageSize: 200 });
      if (next.mode !== 'records' || !next.records.length) break;
      allRecords.push(...next.records);
    }
    const columns = parsed.data.fields?.length
      ? [...new Set(parsed.data.fields)]
      : Object.keys(allRecords[0] || {});
    const csvValue = (value: unknown) => {
      const text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
      const protectedText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${protectedText.replace(/"/g, '""')}"`;
    };
    const csv = [
      columns.map(csvValue).join(','),
      ...allRecords.slice(0, exportLimit).map((record) => columns.map((field) => csvValue(record[field])).join(',')),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="platform-report-${report.id}.csv"`);
    res.setHeader('X-Export-Truncated', first.total > 5000 ? 'true' : 'false');
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'export-csv',
      targetType: 'report',
      targetId: report.id,
      tenantIds: first.scope.tenantIds,
      resultCount: allRecords.length,
    });
    return res.send(csv);
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/reports/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = await reports.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ success: false, error: 'Record not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.put('/reports/:id', async (req: AuthRequest, res: Response) => {
  const parsed = reportInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid report definition', details: parsed.error.issues });
  try {
    const existing = await reports.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    if (existing.isSystem) return res.status(403).json({ success: false, error: 'System definitions are protected' });
    const item = await reports.update({
      where: { id: existing.id },
      data: { ...parsed.data, definition: jsonDefinition(parsed.data.definition), updatedBy: req.user!.id },
    });
    res.json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/reports/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await reports.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    if (existing.isSystem) return res.status(403).json({ success: false, error: 'System definitions are protected' });
    await reports.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id, deleted: true } });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/reports/:id/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await reports.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : `${existing.name} (copy)`;
    const parsedName = z.string().min(1).max(120).safeParse(name);
    if (!parsedName.success) return res.status(400).json({ success: false, error: 'Invalid duplicate name' });
    const item = await reports.create({
      data: {
        name: parsedName.data,
        description: existing.description,
        definition: existing.definition,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/reports/:id/run', async (req: AuthRequest, res: Response) => {
  try {
    const report = await reports.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ success: false, error: 'Record not found' });
    const merged = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? { ...report.definition, ...req.body, model: (report.definition as any).model }
      : report.definition;
    const parsed = querySchema.safeParse(merged);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid run options', details: parsed.error.issues });
    const data = await executeAudited(parsed.data, req.user!.id, 'run-report', report.id);
    res.json({ success: true, data });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/dashboards', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
    const [total, items] = await Promise.all([
      dashboards.count({ where }),
      dashboards.findMany({ where, orderBy: { updatedAt: 'desc' }, take: pageSize, skip: (page - 1) * pageSize }),
    ]);
    res.json({ success: true, data: { items, total, page, pageSize } });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/dashboards', async (req: AuthRequest, res: Response) => {
  const parsed = dashboardInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid dashboard definition', details: parsed.error.issues });
  try {
    const item = await dashboards.create({
      data: { ...parsed.data, definition: jsonDefinition(parsed.data.definition), createdBy: req.user!.id, updatedBy: req.user!.id },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/dashboards/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = await dashboards.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ success: false, error: 'Record not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.put('/dashboards/:id', async (req: AuthRequest, res: Response) => {
  const parsed = dashboardInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid dashboard definition', details: parsed.error.issues });
  try {
    const existing = await dashboards.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    if (existing.isSystem) return res.status(403).json({ success: false, error: 'System definitions are protected' });
    const item = await dashboards.update({
      where: { id: existing.id },
      data: { ...parsed.data, definition: jsonDefinition(parsed.data.definition), updatedBy: req.user!.id },
    });
    res.json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/dashboards/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await dashboards.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    if (existing.isSystem) return res.status(403).json({ success: false, error: 'System definitions are protected' });
    await dashboards.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id, deleted: true } });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/dashboards/:id/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await dashboards.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : `${existing.name} (copy)`;
    const parsedName = z.string().min(1).max(120).safeParse(name);
    if (!parsedName.success) return res.status(400).json({ success: false, error: 'Invalid duplicate name' });
    const item = await dashboards.create({
      data: {
        name: parsedName.data,
        description: existing.description,
        definition: existing.definition,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/dashboards/:id/run', async (req: AuthRequest, res: Response) => {
  try {
    const dashboard = await dashboards.findUnique({ where: { id: req.params.id } });
    if (!dashboard) return res.status(404).json({ success: false, error: 'Record not found' });
    const runOptions = dashboardRunSchema.safeParse(req.body || {});
    if (!runOptions.success) return res.status(400).json({ success: false, error: 'Invalid dashboard run scope', details: runOptions.error.issues });
    const tenantIds = runOptions.data.scope
      ? runOptions.data.scope.mode === 'all'
        ? undefined
        : runOptions.data.scope.tenantIds
      : undefined;
    if (runOptions.data.scope?.mode === 'selected' && !tenantIds?.length) {
      return res.status(400).json({ success: false, error: 'Select at least one tenant for this dashboard scope' });
    }
    const validatedScope = runOptions.data.scope ? await resolveTenantScope(tenantIds) : undefined;
    const definition = dashboard.definition as { widgets?: Array<{ id: string; title: string; query: DataQuery }> };
    const widgets: DashboardWidgetResult[] = await Promise.all((definition.widgets || []).map(async (widget): Promise<DashboardWidgetResult> => {
      try {
        const query = runOptions.data.scope
          ? { ...widget.query, tenantIds }
          : widget.query;
        const parsed = querySchema.safeParse(query);
        if (!parsed.success) throw new ReportingError('Stored widget query is invalid');
        return { id: widget.id, title: widget.title, success: true, data: await executeDataQuery(parsed.data) };
      } catch (error) {
        return { id: widget.id, title: widget.title, success: false, error: error instanceof ReportingError ? error.message : 'Widget query failed' };
      }
    }));
    await writeExecutionAudit({
      actorId: req.user!.id,
      operation: 'run-dashboard',
      targetType: 'dashboard',
      targetId: dashboard.id,
      tenantIds: validatedScope?.tenantIds || [...new Set(widgets.flatMap((widget) => (
        widget.success ? widget.data.scope.tenantIds : []
      )))],
      resultCount: widgets.reduce((count, widget) => {
        if (!widget.success) return count;
        return count + (widget.data.mode === 'records' ? widget.data.records.length : widget.data.groups.length);
      }, 0),
      succeeded: widgets.every((widget) => widget.success),
      errorCode: widgets.some((widget) => !widget.success) ? 'WIDGET_QUERY_FAILED' : undefined,
    });
    res.json({
      success: true,
      data: { dashboardId: dashboard.id, scope: validatedScope || null, widgets, executedAt: new Date().toISOString() },
    });
  } catch (error) {
    respondError(res, error);
  }
});

export default router;
