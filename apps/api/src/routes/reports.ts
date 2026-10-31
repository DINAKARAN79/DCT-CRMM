import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma, ReportVisibility } from '@dct-crm/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { loadEffectivePermissions } from '../middleware/permissions';
import { auditLog } from '../middleware/audit';
import { REPORT_OBJECTS, getReportMetadataRegistry } from '../reports/report-metadata';
import { runReport, parseFilterExpression, canAccessReportForUser, canAccessReportFolderForUser } from '../reports/report-engine';
import { followUpReportShowMe } from '../services/followUpAccess';
import { createReportCsv, reportCsvFilename } from '../reports/report-csv-export';
import { resolveReportShowMe } from '../services/recordAccess';

const router = Router();
export const reportFolderRouter = Router();
export const reportMetadataRouter = Router();

function persistReportConfig(config: unknown, body: Record<string, unknown>) {
  const next = config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
  if (Array.isArray(body.aggregates)) next.aggregates = body.aggregates;
  if (Array.isArray(body.rowGroups)) next.rowGroups = body.rowGroups;
  if (Array.isArray(body.columnGroups)) next.columnGroups = body.columnGroups;
  if (body.filterLogic === 'AND' || body.filterLogic === 'OR') next.filterLogic = body.filterLogic;
  if (body.sortOrder === 'asc' || body.sortOrder === 'desc') next.sortOrder = body.sortOrder;
  return Object.keys(next).length ? next as Prisma.InputJsonValue : undefined;
}

function presentReport(report: { config: unknown; groupBy: string | null; createdBy: string }, createdByName?: string) {
  const reportConfig = report.config && typeof report.config === 'object' && !Array.isArray(report.config)
    ? report.config as Record<string, unknown>
    : {};
  const rowGroups = Array.isArray(reportConfig.rowGroups) && reportConfig.rowGroups.length
    ? reportConfig.rowGroups
    : report.groupBy
      ? [report.groupBy]
      : [];
  const columnGroups = Array.isArray(reportConfig.columnGroups) ? reportConfig.columnGroups : [];
  return {
    ...report,
    createdByName,
    aggregates: Array.isArray(reportConfig.aggregates) ? reportConfig.aggregates : [],
    rowGroups,
    columnGroups,
    filterLogic: reportConfig.filterLogic === 'OR' ? 'OR' : 'AND',
    sortOrder: reportConfig.sortOrder === 'asc' ? 'asc' : 'desc',
  };
}

router.use(authenticate);
router.use(loadEffectivePermissions);
reportMetadataRouter.use(authenticate);
reportMetadataRouter.use(loadEffectivePermissions);
reportFolderRouter.use(authenticate);
reportFolderRouter.use(loadEffectivePermissions);

router.get('/metadata', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const registry = await getReportMetadataRegistry(req.tenantId!);
    res.json({ success: true, data: registry.objects });
  } catch (error: any) {
    console.error('Get report metadata error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report metadata' });
  }
});

router.get('/field-values', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const objectName = String(req.query.objectName || '');
    const fieldName = String(req.query.field || '');
    const objectConfig = REPORT_OBJECTS[objectName];
    const field = objectConfig?.fields[fieldName];
    if (!objectConfig || !field || field.type !== 'enum') {
      return res.status(400).json({ success: false, error: 'Invalid picklist field' });
    }

    const selectPath = (path: string): Record<string, unknown> => {
      const parts = path.split('.');
      let selection: Record<string, unknown> = { [parts[parts.length - 1]]: true };
      for (let index = parts.length - 2; index >= 0; index -= 1) selection = { [parts[index]]: selection };
      return selection;
    };
    const getValue = (record: any, path: string) => path.split('.').reduce((current, key) => current?.[key], record);
    const delegate = (prisma as any)[objectConfig.model];
    const records = await delegate.findMany({ where: { tenantId: req.tenantId! }, select: selectPath(field.path), take: 1000 });
    const values = [...new Set(records.map((record: any) => getValue(record, field.path)).filter((value: unknown) => value !== null && value !== undefined && value !== ''))].sort();
    res.json({ success: true, data: values });
  } catch (error: any) {
    console.error('Get report field values error:', error);
    res.status(500).json({ success: false, error: 'Failed to load picklist values' });
  }
});

reportMetadataRouter.get('/', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const registry = await getReportMetadataRegistry(req.tenantId!);
    res.json({ success: true, data: registry.objects });
  } catch (error: any) {
    console.error('Get report metadata registry error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report metadata' });
  }
});

reportMetadataRouter.get('/:object', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const registry = await getReportMetadataRegistry(req.tenantId!, req.params.object);
    res.json({ success: true, data: registry });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch report metadata';
    const status = message.includes('Unknown report object') ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/run', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { objectName, columns, filters, filterExpression, crossFilter, filterLogic, showMe, aggregates, groupBy, groupColumn, rowGroups, columnGroups, groupOptions, sortBy, sortOrder, sortRules, limit } = req.body;
    if (!objectName || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ success: false, error: 'objectName and at least one column are required' });
    }
    const filterTree = typeof filterExpression === 'string' && filterExpression.trim() ? parseFilterExpression(filterExpression, filters?.length || 0) : undefined;
    const forcedShowMe = followUpReportShowMe(objectName, req.user!, await resolveReportShowMe(req.user!, showMe));
    const data = await runReport({ tenantId: req.tenantId!, userId: req.user!.id, objectName, columns, filters, filterTree, showMe: forcedShowMe, crossFilter, filterLogic, aggregates, groupBy, groupColumn, rowGroups, columnGroups, groupOptions, sortBy, sortOrder, sortRules, limit });
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Run report error:', error);
    res.status(400).json({ success: false, error: error.message || 'Failed to run report' });
  }
});

function ensureReportAccess(report: { createdBy?: string | null; isShared?: boolean | null; tenantId?: string | null } | null, req: AuthRequest) {
  if (!report) {
    return false;
  }

  const permissions = req.effectivePermissions?.map((perm) => perm.name) || [];
  return canAccessReportForUser(report, {
    id: req.user!.id,
    tenantId: req.tenantId!,
    isSuperAdmin: req.user!.isSuperAdmin,
  }, permissions);
}

async function getReportShare(reportId: string, req: AuthRequest) {
  const roleIds = await prisma.userRole.findMany({ where: { userId: req.user!.id }, select: { roleId: true } });
  return prisma.reportShare.findFirst({ where: { reportId, tenantId: req.tenantId!, OR: [{ userId: req.user!.id }, ...(roleIds.length ? [{ roleId: { in: roleIds.map((role) => role.roleId) } }] : [])] } });
}

async function ensureReportAccessWithShare(report: { id: string; createdBy?: string | null; isShared?: boolean | null; tenantId?: string | null } | null, req: AuthRequest) {
  if (ensureReportAccess(report, req)) return true;
  return Boolean(report && await getReportShare(report.id, req));
}

async function ensureReportEditAccess(report: { id: string; createdBy?: string | null; isShared?: boolean | null; tenantId?: string | null } | null, req: AuthRequest) {
  if (!report) return false;
  if (report.createdBy === req.user!.id || req.user?.isSuperAdmin) return true;
  const share = await getReportShare(report.id, req);
  return share?.accessLevel === 'EDITOR';
}

function ensureReportFolderAccess(folder: { createdBy?: string | null; isShared?: boolean | null; tenantId?: string | null } | null, req: AuthRequest) {
  if (!folder) {
    return false;
  }

  const permissions = req.effectivePermissions?.map((perm) => perm.name) || [];
  return canAccessReportFolderForUser(folder, {
    id: req.user!.id,
    tenantId: req.tenantId!,
    isSuperAdmin: req.user!.isSuperAdmin,
  }, permissions);
}

const nullableString = z.string().nullable().optional();

const reportSchema = z.object({
  name: z.string().min(1),
  description: nullableString,
  type: z.string().min(1),
  objectName: z.string().min(1),
  columns: z.array(z.string()).min(1),
  config: z.any().optional(),
  filters: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.any(),
  })).optional(),
  groupBy: nullableString,
  sortBy: nullableString,
  folderId: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
});

const updateReportSchema = reportSchema.partial();

router.get('/', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const allCompanies = !req.impersonation && req.user!.isSuperAdmin && req.query.scope === 'allCompanies';
    const tenantId = allCompanies ? undefined : req.tenantId!;
    const viewingCompanyAsSuperAdmin = req.user!.isSuperAdmin && tenantId !== req.user!.tenantId;
    const { id: userId } = req.user!;
    const { page = 1, limit = 25, type, objectName, isShared, search, view = 'recent', folderId, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const pageNumber = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const skip = (pageNumber - 1) * pageLimit;
    const allowedSortFields = new Set(['name', 'createdAt', 'updatedAt', 'createdBy']);
    const safeSortBy = allowedSortFields.has(String(sortBy)) ? String(sortBy) : 'createdAt';
    const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    const matchingUserIds = search
      ? (await prisma.user.findMany({ where: { tenantId, OR: [{ firstName: { contains: search as string, mode: 'insensitive' } }, { lastName: { contains: search as string, mode: 'insensitive' } }, { email: { contains: search as string, mode: 'insensitive' } }] }, select: { id: true } })).map((user) => user.id)
      : [];
    const userRoleIds = (await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })).map((role) => role.roleId);
    const sharedReportIds = await prisma.reportShare.findMany({ where: { tenantId, OR: [{ userId }, ...(userRoleIds.length ? [{ roleId: { in: userRoleIds } }] : [])] }, select: { reportId: true } });
    const searchClause = search ? {
      OR: [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        ...(matchingUserIds.length ? [{ createdBy: { in: matchingUserIds } }] : []),
      ],
    } : {};

    const where: any = { ...(tenantId ? { tenantId } : {}), deletedAt: null };

    if (allCompanies || viewingCompanyAsSuperAdmin) {
      // The company setup-home builder needs the selected company's own reports.
    } else if (view === 'private') {
      where.OR = [{ createdBy: userId }, { id: { in: sharedReportIds.map((share) => share.reportId) } }];
      where.isShared = false;
    } else if (view === 'public') {
      where.isShared = true;
    } else if (view === 'createdByMe') {
      where.createdBy = userId;
    } else if (view === 'favorites') {
      where.favorites = { some: { userId } };
    } else if (view === 'sharedWithMe') {
      where.id = { in: sharedReportIds.map((share) => share.reportId) };
    } else {
      where.OR = [
        { createdBy: userId },
        { isShared: true },
        { id: { in: sharedReportIds.map((share) => share.reportId) } },
      ];
    }

    if (type) where.type = type;
    if (objectName) where.objectName = objectName;
    if (isShared !== undefined) where.isShared = isShared === 'true';
    if (folderId) where.folderId = folderId;
    if (search) {
      where.AND = [searchClause];
    }

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        skip,
        take: pageLimit,
        include: {
          folder: { select: { id: true, name: true } },
          favorites: { where: { userId }, select: { id: true } },
          tenant: { select: { id: true, name: true } },
        },
        orderBy: { [safeSortBy]: safeSortOrder },
      }),
      prisma.report.count({ where }),
    ]);

    const userIds = [...new Set(reports.map((report) => report.createdBy).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, ...(tenantId ? { tenantId } : {}) },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.id, `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || user.id]));

    const enrichedReports = reports.map((report) => ({
      ...report,
      isFavorite: report.favorites.length > 0,
      createdByName: userMap.get(report.createdBy) || report.createdBy,
    }));

    res.json({
      success: true,
      data: { items: enrichedReports, pagination: {
        page: pageNumber,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit),
      } },
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

router.get('/:id', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const report = await prisma.report.findFirst({
      where: { id: req.params.id, tenantId },
      include: { folder: { select: { id: true, name: true } } },
    });

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (!(await ensureReportAccessWithShare(report, req))) {
      return res.status(403).json({ success: false, error: 'Access denied: report is not shared with you' });
    }

    const creator = await prisma.user.findUnique({
      where: { id: report.createdBy },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const creatorName = creator ? `${creator.firstName || ''} ${creator.lastName || ''}`.trim() || creator.email || creator.id : report.createdBy;

    res.json({ success: true, data: presentReport(report, creatorName) });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report' });
  }
});

router.post('/:id/favorite', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!(await ensureReportAccessWithShare(report, req))) return res.status(403).json({ success: false, error: 'Access denied' });
    const favorite = await prisma.reportFavorite.upsert({ where: { reportId_userId: { reportId: req.params.id, userId } }, create: { id: randomUUID(), tenantId, reportId: req.params.id, userId }, update: {} });
    await auditLog(tenantId, userId, 'FAVORITE', 'Report', req.params.id, null, { favorite: true });
    res.json({ success: true, data: { isFavorite: true, favorite } });
  } catch (error) { console.error('Favorite report error:', error); res.status(500).json({ success: false, error: 'Failed to favorite report' }); }
});

router.post('/:id/share', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId } });
    if (!report || (report.createdBy !== userId && !req.user?.isSuperAdmin)) return res.status(403).json({ success: false, error: 'Only the report owner can share this report' });
    const targetUser = req.body.userId ? await prisma.user.findFirst({ where: { id: req.body.userId, tenantId }, select: { id: true } }) : null;
    const targetRole = req.body.roleId ? await prisma.role.findFirst({ where: { id: req.body.roleId, tenantId }, select: { id: true } }) : null;
    if (!targetUser && !targetRole) return res.status(400).json({ success: false, error: 'A valid userId or roleId is required' });
    const accessLevel = req.body.accessLevel === 'EDITOR' ? 'EDITOR' : 'VIEWER';
    const existingShare = await prisma.reportShare.findFirst({ where: { reportId: report.id, userId: targetUser?.id || null, roleId: targetRole?.id || null } });
    const share = existingShare
      ? await prisma.reportShare.update({ where: { id: existingShare.id }, data: { accessLevel } })
      : await prisma.reportShare.create({ data: { id: randomUUID(), tenantId, reportId: report.id, userId: targetUser?.id, roleId: targetRole?.id, accessLevel, createdBy: userId } });
    await auditLog(tenantId, userId, existingShare ? 'UPDATE_SHARE' : 'SHARE', 'Report', report.id, existingShare, share);
    res.status(201).json({ success: true, data: share });
  } catch (error) { console.error('Share report error:', error); res.status(500).json({ success: false, error: 'Failed to share report' }); }
});

router.delete('/:id/share/:shareId', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!report || (report.createdBy !== req.user!.id && !req.user?.isSuperAdmin)) return res.status(403).json({ success: false, error: 'Only the report owner can change sharing' });
    await prisma.reportShare.deleteMany({ where: { id: req.params.shareId, reportId: report.id, tenantId: req.tenantId! } });
    await auditLog(req.tenantId!, req.user!.id, 'UNSHARE', 'Report', report.id, { shareId: req.params.shareId }, null);
    res.json({ success: true, data: null });
  } catch (error) { console.error('Unshare report error:', error); res.status(500).json({ success: false, error: 'Failed to remove report share' }); }
});

router.delete('/:id/favorite', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.reportFavorite.deleteMany({ where: { reportId: req.params.id, userId: req.user!.id, tenantId: req.tenantId! } });
    await auditLog(req.tenantId!, req.user!.id, 'UNFAVORITE', 'Report', req.params.id, { favorite: true }, { favorite: false });
    res.json({ success: true, data: { isFavorite: false } });
  } catch (error) { console.error('Unfavorite report error:', error); res.status(500).json({ success: false, error: 'Failed to remove report favorite' }); }
});

router.post('/', authorize('Report', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const data = reportSchema.parse(req.body);

    const report = await prisma.report.create({
      data: {
        tenantId,
        createdBy: userId,
        name: data.name,
        description: data.description,
        type: data.type,
        objectName: data.objectName,
        columns: data.columns,
        config: persistReportConfig(data.config, req.body),
        filters: data.filters as unknown as Prisma.InputJsonValue | undefined,
        groupBy: data.groupBy,
        sortBy: data.sortBy,
        folderId: data.folderId || null,
        isShared: data.isShared || false,
      },
    });

    await auditLog(tenantId, userId, 'CREATE', 'Report', report.id, null, { name: data.name, objectName: data.objectName });

    res.status(201).json({ success: true, data: report });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create report error:', error);
    res.status(500).json({ success: false, error: 'Failed to create report' });
  }
});

router.patch('/:id/move', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const folderId = req.body.folderId || null;
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId } });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (folderId) {
      const folder = await prisma.reportFolder.findFirst({ where: { id: folderId, tenantId } });
      if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    }
    const updated = await prisma.report.update({ where: { id: report.id }, data: { folderId } });
    res.json({ success: true, data: updated });
    await auditLog(tenantId, req.user!.id, 'MOVE', 'Report', report.id, { folderId: report.folderId }, { folderId });
  } catch (error) {
    console.error('Move report error:', error);
    res.status(500).json({ success: false, error: 'Failed to move report' });
  }
});

router.get('/:id/export', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const format = String(req.query.format || 'csv').toLowerCase();
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (!(await ensureReportAccessWithShare(report, req))) return res.status(403).json({ success: false, error: 'You do not have permission to export this report' });

    const reportConfig = (report.config && typeof report.config === 'object' ? report.config : {}) as Record<string, any>;
    const savedRowGroups = Array.isArray(reportConfig.rowGroups) && reportConfig.rowGroups.length
      ? reportConfig.rowGroups as string[]
      : report.groupBy
        ? [report.groupBy]
        : [];
    const savedColumnGroups = Array.isArray(reportConfig.columnGroups) && reportConfig.columnGroups.length
      ? reportConfig.columnGroups as string[]
      : [];
    const savedAggregates = Array.isArray(reportConfig.aggregates) ? reportConfig.aggregates as any[] : [];
    const savedFilterLogic = reportConfig.filterLogic === 'OR' ? 'OR' as const : 'AND' as const;
    const savedSortOrder = reportConfig.sortOrder === 'asc' ? 'asc' as const : 'desc' as const;
    const forcedShowMe = followUpReportShowMe(report.objectName, req.user!, await resolveReportShowMe(req.user!, reportConfig.showMe));

    const result = await runReport({
      tenantId,
      userId: req.user!.id,
      objectName: report.objectName,
      columns: Array.isArray(report.columns) ? report.columns as string[] : [],
      filters: Array.isArray(report.filters) ? report.filters as any[] : [],
      filterLogic: savedFilterLogic,
      showMe: forcedShowMe,
      aggregates: savedAggregates,
      groupBy: savedRowGroups[0] || undefined,
      groupColumn: savedColumnGroups[0] || undefined,
      rowGroups: savedRowGroups.length ? savedRowGroups : undefined,
      columnGroups: savedColumnGroups.length ? savedColumnGroups : undefined,
      groupOptions: reportConfig.groupDateBuckets
        ? Object.fromEntries(Object.entries(reportConfig.groupDateBuckets as Record<string, string>).map(([field, dateBucket]) => [field, { dateBucket }]))
        : undefined,
      sortBy: report.sortBy || undefined,
      sortOrder: savedSortOrder,
      limit: 10000,
    });

    const columns = result.columns || [];
    let rows = result.rows || [];

    if (result.groups?.length) {
      rows = result.groups.map((group) => {
        const row: Record<string, unknown> = {};
        for (const column of columns) {
          if (column === 'count') row[column] = group.count;
          else if (group.groupValues && column in group.groupValues) row[column] = group.groupValues[column];
          else if (group.summary && column in group.summary) row[column] = group.summary[column];
          else row[column] = group.groupValues?.[column] ?? null;
        }
        return row;
      });
    }
    const safeName = report.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'report';
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${reportCsvFilename(report.name)}"`);
      return res.send(createReportCsv({ columns, rows }));
    }
    if (format === 'excel' || format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(report.name.slice(0, 31));
      sheet.addRow(columns);
      rows.forEach((row: Record<string, unknown>) => sheet.addRow(columns.map((column: string) => row[column])));
      sheet.getRow(1).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }
    if (format === 'pdf') {
      const document = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`); res.send(Buffer.concat(chunks)); });
      document.fontSize(16).text(report.name).moveDown(0.5).fontSize(8);
      document.text(columns.join(' | '));
      rows.forEach((row: Record<string, unknown>) => document.text(columns.map((column: string) => String(row[column] ?? '')).join(' | ')));
      if (result.summary && Object.keys(result.summary).length) document.moveDown().text(`Summary: ${JSON.stringify(result.summary)}`);
      document.end();
      return;
    }
    res.status(400).json({ success: false, error: 'Unsupported export format' });
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ success: false, error: 'Failed to export report' });
  }
});

reportFolderRouter.use(authenticate);

reportFolderRouter.get('/', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const allCompanies = !req.impersonation && req.user!.isSuperAdmin && req.query.scope === 'allCompanies';
    const tenantId = allCompanies ? undefined : req.tenantId!;
    const { id: userId } = req.user!;
    const view = String(req.query.view || 'all');
    const search = String(req.query.search || '').trim();
    const roleIdsForAccess = (await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })).map((role) => role.roleId);
    const directlySharedFolderIds = (await prisma.reportFolderShare.findMany({ where: { tenantId, OR: [{ userId }, ...(roleIdsForAccess.length ? [{ roleId: { in: roleIdsForAccess } }] : [])] }, select: { folderId: true } })).map((share) => share.folderId);
    const where: any = { ...(tenantId ? { tenantId } : {}), deletedAt: null };
    if (allCompanies) {
      // Super admins manage folders across tenants from the platform-wide view.
    } else if (view === 'favorites') {
      where.favorites = { some: { userId } };
    } else if (view === 'all') {
      where.OR = [{ createdBy: userId }, { visibility: 'PUBLIC' }, { isShared: true }, { id: { in: directlySharedFolderIds } }];
    } else if (view === 'createdByMe') {
      where.createdBy = userId;
    } else if (view === 'sharedWithMe') {
      where.OR = [{ visibility: 'PUBLIC' }, { id: { in: directlySharedFolderIds } }];
      where.NOT = { createdBy: userId };
    }
    if (search) {
      const matchingUsers = await prisma.user.findMany({ where: { tenantId, OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }, select: { id: true } });
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { createdBy: { in: matchingUsers.map((user) => user.id) } }, { modifiedBy: { in: matchingUsers.map((user) => user.id) } }];
    }
    const folders = await prisma.reportFolder.findMany({
      where,
      include: {
        _count: { select: { reports: true } },
        favorites: { where: { userId }, select: { id: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const sharedFolderIdSet = new Set(directlySharedFolderIds);
    const accessibleFolders = folders.filter((folder) => {
      if (folder.createdBy === userId || req.user?.isSuperAdmin) return true;
      return folder.visibility === 'PUBLIC' || folder.isShared || sharedFolderIdSet.has(folder.id);
    });
    const userIds = [...new Set(accessibleFolders.flatMap((folder) => [folder.createdBy, folder.modifiedBy]).filter((id): id is string => Boolean(id)))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, ...(tenantId ? { tenantId } : {}) },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];

    const userMap = new Map(users.map((user) => [user.id, `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || user.id]));

    res.json({
      success: true,
      data: accessibleFolders.map((folder) => ({
        ...folder,
        isFavorite: folder.favorites.length > 0,
        isDeleted: Boolean(folder.deletedAt),
        owner: folder.createdBy,
        ownerName: userMap.get(folder.createdBy) || folder.createdBy,
        createdByName: userMap.get(folder.createdBy) || folder.createdBy,
        modifiedByName: folder.modifiedBy ? userMap.get(folder.modifiedBy) || folder.modifiedBy : userMap.get(folder.createdBy) || folder.createdBy,
        favorites: undefined,
      })),
    });
  } catch (error) {
    console.error('Get report folders error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch report folders' });
  }
});

reportFolderRouter.post('/:id/favorite', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const folder = await prisma.reportFolder.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!ensureReportFolderAccess(folder, req)) return res.status(403).json({ success: false, error: 'Access denied' });
    const favorite = await prisma.reportFolderFavorite.upsert({ where: { folderId_userId: { folderId: req.params.id, userId } }, create: { id: randomUUID(), tenantId, folderId: req.params.id, userId }, update: {} });
    res.json({ success: true, data: { isFavorite: true, favorite } });
  } catch (error) { console.error('Favorite folder error:', error); res.status(500).json({ success: false, error: 'Failed to favorite folder' }); }
});

reportFolderRouter.delete('/:id/favorite', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.reportFolderFavorite.deleteMany({ where: { folderId: req.params.id, userId: req.user!.id, tenantId: req.tenantId! } });
    res.json({ success: true, data: { isFavorite: false } });
  } catch (error) { console.error('Unfavorite folder error:', error); res.status(500).json({ success: false, error: 'Failed to remove folder favorite' }); }
});

reportFolderRouter.post('/:id/share', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const folder = await prisma.reportFolder.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!folder || (folder.createdBy !== userId && !req.user?.isSuperAdmin)) return res.status(403).json({ success: false, error: 'Only the folder owner can share this folder' });
    const targetUser = req.body.userId ? await prisma.user.findFirst({ where: { id: req.body.userId, tenantId }, select: { id: true } }) : null;
    const targetRole = req.body.roleId ? await prisma.role.findFirst({ where: { id: req.body.roleId, tenantId }, select: { id: true } }) : null;
    if (!targetUser && !targetRole) return res.status(400).json({ success: false, error: 'A valid userId or roleId is required' });
    const accessLevel = req.body.accessLevel === 'EDITOR' ? 'EDITOR' : 'VIEWER';
    const existingShare = await prisma.reportFolderShare.findFirst({ where: { folderId: folder.id, userId: targetUser?.id || null, roleId: targetRole?.id || null } });
    const share = existingShare
      ? await prisma.reportFolderShare.update({ where: { id: existingShare.id }, data: { accessLevel } })
      : await prisma.reportFolderShare.create({ data: { id: randomUUID(), tenantId, folderId: folder.id, userId: targetUser?.id, roleId: targetRole?.id, accessLevel, createdBy: userId } });
    res.status(201).json({ success: true, data: share });
  } catch (error) { console.error('Share folder error:', error); res.status(500).json({ success: false, error: 'Failed to share folder' }); }
});

reportFolderRouter.delete('/:id/share/:shareId', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const folder = await prisma.reportFolder.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!folder || (folder.createdBy !== req.user!.id && !req.user?.isSuperAdmin)) return res.status(403).json({ success: false, error: 'Only the folder owner can change sharing' });
    await prisma.reportFolderShare.deleteMany({ where: { id: req.params.shareId, folderId: folder.id, tenantId: req.tenantId! } });
    res.json({ success: true, data: null });
  } catch (error) { console.error('Unshare folder error:', error); res.status(500).json({ success: false, error: 'Failed to remove folder share' }); }
});

reportFolderRouter.post('/', authorize('Report', 'create'), async (req: AuthRequest, res: Response) => {
  const requestedFolderName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const name = requestedFolderName;
    if (!name) return res.status(400).json({ success: false, error: 'Folder name is required' });
    const visibility = req.body.visibility === 'PUBLIC' || req.body.isShared ? ReportVisibility.PUBLIC : ReportVisibility.PRIVATE;
    const description = typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
    const existing = await prisma.reportFolder.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
    });

    if (existing && !existing.deletedAt) {
      return res.status(409).json({ success: false, error: `A folder named "${existing.name}" already exists. Choose a different name.` });
    }

    if (existing?.deletedAt) {
      const restored = await prisma.reportFolder.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          description,
          visibility,
          isShared: visibility !== 'PRIVATE',
          modifiedBy: userId,
        },
      });
      await auditLog(tenantId, userId, 'RESTORE', 'ReportFolder', restored.id, { deletedAt: existing.deletedAt }, restored);
      return res.status(201).json({ success: true, data: restored, restored: true });
    }

    const folder = await prisma.reportFolder.create({
      data: {
        tenantId,
        createdBy: userId,
        name,
        description,
        visibility,
        isShared: visibility !== 'PRIVATE',
        modifiedBy: userId,
      },
    });
    res.status(201).json({ success: true, data: folder });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: `A folder named "${requestedFolderName || 'this'}" already exists. Choose a different name.` });
    console.error('Create report folder error:', error);
    res.status(500).json({ success: false, error: 'Failed to create report folder' });
  }
});

reportFolderRouter.put('/:id', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const existing = await prisma.reportFolder.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!existing) return res.status(404).json({ success: false, error: 'Folder not found' });
    if (existing.createdBy !== userId && !req.user?.isSuperAdmin) return res.status(403).json({ success: false, error: 'Access denied: you can only update your own folder' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : existing.name;
    const visibility = req.body.visibility === 'PUBLIC' ? ReportVisibility.PUBLIC : req.body.visibility === 'PRIVATE' ? ReportVisibility.PRIVATE : existing.visibility;
    const folder = await prisma.reportFolder.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        description: typeof req.body.description === 'string' ? req.body.description.trim() || null : existing.description,
        visibility,
        isShared: visibility !== 'PRIVATE',
        modifiedBy: userId,
      },
    });
    res.json({ success: true, data: folder });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'A folder with this name already exists' });
    console.error('Update report folder error:', error);
    res.status(500).json({ success: false, error: 'Failed to update report folder' });
  }
});

reportFolderRouter.delete('/:id', authorize('Report', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const existing = await prisma.reportFolder.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!existing) return res.status(404).json({ success: false, error: 'Folder not found' });
    if (existing.createdBy !== userId && !req.user?.isSuperAdmin) return res.status(403).json({ success: false, error: 'Access denied: you can only delete your own folder' });
    await prisma.reportFolder.update({ where: { id: existing.id }, data: { deletedAt: new Date(), modifiedBy: userId } });
    res.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete report folder error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete report folder' });
  }
});

router.put('/:id', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;

    const existing = await prisma.report.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (!(await ensureReportEditAccess(existing, req))) {
      return res.status(403).json({ success: false, error: 'Access denied: you can only update your own report' });
    }

    const data = updateReportSchema.parse(req.body);

    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: {
        ...data,
        config: persistReportConfig(data.config !== undefined ? data.config : existing.config, req.body),
        filters: data.filters as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Report', report.id, existing, report);

    res.json({ success: true, data: report });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update report error:', error);
    res.status(500).json({ success: false, error: 'Failed to update report' });
  }
});

router.delete('/:id', authorize('Report', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;

    const existing = await prisma.report.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (existing.createdBy !== userId && !req.user?.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied: you can only delete your own report' });
    }

    await prisma.report.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });

    await auditLog(tenantId, userId, 'DELETE', 'Report', existing.id, existing, null);

    res.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete report' });
  }
});

router.post('/:id/restore', authorize('Report', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, tenantId: req.tenantId!, deletedAt: { not: null } } });
    if (!report) return res.status(404).json({ success: false, error: 'Deleted report not found' });
    if (report.createdBy !== req.user!.id && !req.user?.isSuperAdmin) return res.status(403).json({ success: false, error: 'Only the owner can restore this report' });
    const restored = await prisma.report.update({ where: { id: report.id }, data: { deletedAt: null } });
    await auditLog(req.tenantId!, req.user!.id, 'RESTORE', 'Report', report.id, { deletedAt: report.deletedAt }, { deletedAt: null });
    res.json({ success: true, data: restored });
  } catch (error) { console.error('Restore report error:', error); res.status(500).json({ success: false, error: 'Failed to restore report' }); }
});

router.post('/:id/clone', authorize('Report', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { id: userId } = req.user!;
    const source = await prisma.report.findFirst({ where: { id: req.params.id, tenantId, deletedAt: null } });
    if (!(await ensureReportAccessWithShare(source, req))) return res.status(403).json({ success: false, error: 'You do not have permission to clone this report' });
    if (!source) return res.status(404).json({ success: false, error: 'Report not found' });
    const requestedName = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : `${source.name} - Copy`;
    const report = await prisma.report.create({ data: { tenantId, createdBy: userId, name: requestedName, description: source.description, type: source.type, objectName: source.objectName, columns: source.columns as any, config: source.config as any, filters: source.filters as any, groupBy: source.groupBy, sortBy: source.sortBy, folderId: source.folderId, isShared: false } });
    await auditLog(tenantId, userId, 'CLONE', 'Report', report.id, { sourceReportId: source.id }, { name: report.name });
    res.status(201).json({ success: true, data: report });
  } catch (error: any) { if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'A report with this name already exists' }); console.error('Clone report error:', error); res.status(500).json({ success: false, error: 'Failed to clone report' }); }
});

router.post('/:id/execute', authorize('Report', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const report = await prisma.report.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (!(await ensureReportAccessWithShare(report, req))) {
      return res.status(403).json({ success: false, error: 'Access denied: report is not shared with you' });
    }

    const filters = (report.filters as Record<string, any>) || {};
    const columns = report.columns as string[];
    const groupBy = report.groupBy;

    const modelMap: Record<string, any> = {
      Lead: prisma.lead,
      SiteVisit: prisma.siteVisit,
      Project: prisma.project,
      Unit: prisma.unit,
      FollowUp: prisma.followUp,
      Activity: prisma.activity,
    };

    const model = modelMap[report.objectName];
    if (!model) {
      return res.status(400).json({ success: false, error: `Unsupported object type: ${report.objectName}` });
    }

    const forcedShowMe = followUpReportShowMe(report.objectName, req.user!, await resolveReportShowMe(req.user!, 'all'));
    const scopeClause = forcedShowMe === 'mine' && req.user
      ? { ownerId: req.user.id }
      : null;
    const where: any = scopeClause
      ? { tenantId, AND: [{ ...filters }, scopeClause] }
      : { tenantId, ...filters };

    const data = await model.findMany({
      where,
      select: columns.length > 0 ? columns.reduce((acc: any, col: string) => ({ ...acc, [col]: true }), { id: true }) : undefined,
      orderBy: report.sortBy ? { [report.sortBy]: 'desc' } : undefined,
      take: 1000,
    });

    let result = data;

    if (groupBy) {
      const grouped: Record<string, any[]> = {};
      for (const item of data) {
        const key = String(item[groupBy] || 'Unknown');
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      }
      result = Object.entries(grouped).map(([key, items]) => ({
        group: key,
        count: items.length,
        items,
      }));
    }

    res.json({ success: true, data: result, report });
  } catch (error) {
    console.error('Execute report error:', error);
    res.status(500).json({ success: false, error: 'Failed to execute report' });
  }
});

export default router;