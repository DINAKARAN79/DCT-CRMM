import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '@dct-crm/db';
import type { AuthRequest } from '../middleware/auth';
import { requestIp } from './apiKeys';

export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;
export const IMPERSONATION_HARD_CAP_MS = 8 * 60 * 60 * 1000;
export const IMPERSONATION_REAUTH_MS = 15 * 60 * 1000;
export const MAX_CONCURRENT_IMPERSONATIONS = 3;

const SECRET_RESPONSE_KEYS = new Set([
  'passwordHash',
  'passwordResetToken',
  'passwordResetExpires',
  'keyHash',
  'secret',
  'apiSecret',
  'accountSid',
  'authToken',
]);

export class ImpersonationError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public admins?: ImpersonationAdmin[],
  ) {
    super(message);
  }
}

export interface ImpersonationAdmin {
  id: string;
  name: string;
  email: string;
  profileName: string;
}

export interface ImpersonationState {
  id: string;
  superadminId: string;
  tenantId: string;
  actingAsUserId: string;
  viewOnly: boolean;
  allowInactive: boolean;
  hardExpiresAt: Date;
  returnPath: string;
}

type TokenClaims = {
  id: string;
  isImpersonation?: boolean;
  impersonationId?: string;
  impersonatedBy?: string;
  tenantId?: string;
  loginAt?: number;
};

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || 'Admin';
}

export function kolkataDayStart(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${day}T00:00:00+05:30`);
}

export function companyAccessBlock(tenant: {
  isActive: boolean;
  companyStartDate?: Date | null;
  companyExpiryDate?: Date | null;
}, now = new Date()) {
  if (!tenant.isActive) return 'This company is deactivated.';
  if (tenant.companyStartDate && now < tenant.companyStartDate) return 'This company has not started yet.';
  if (tenant.companyExpiryDate && now > tenant.companyExpiryDate) return 'This company subscription has expired.';
  return null;
}

function sessionIsOpen(session: { endedAt: Date | null; hardExpiresAt: Date }, now = new Date()) {
  return !session.endedAt && session.hardExpiresAt > now;
}

export async function endImpersonation(id: string, endReason: string) {
  await prisma.impersonationSession.updateMany({
    where: { id, endedAt: null },
    data: { endedAt: new Date(), endReason, lastActivityAt: new Date() },
  });
}

export async function impersonatorNames(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, string>();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(users.map((user) => [user.id, displayName(user)]));
}

export async function withImpersonatorNames<T extends object>(rows: T[]) {
  const rowsWithActor = rows.map((row) => ({
    row,
    actorId: 'impersonatedById' in row && typeof row.impersonatedById === 'string'
      ? row.impersonatedById
      : null,
  }));
  const names = await impersonatorNames(rowsWithActor.map(({ actorId }) => actorId));
  return rowsWithActor.map(({ row, actorId }) => ({
    ...row,
    impersonatedByName: actorId ? names.get(actorId) || 'Superadmin' : null,
  }));
}

export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_RESPONSE_KEYS.has(key) ? '••••••' : redactSecrets(nested, depth + 1);
  }
  return output as T;
}

export function impersonationExpirySeconds(hardExpiresAt: Date, now = Date.now()) {
  return Math.max(1, Math.min(Math.floor(IMPERSONATION_TTL_MS / 1000), Math.floor((hardExpiresAt.getTime() - now) / 1000)));
}

const WRITE_ALLOWLIST = ['/api/impersonation/exit', '/api/auth/logout', '/api/auth/refresh'];

export function assertImpersonationRequestAllowed(req: AuthRequest) {
  const session = req.impersonation;
  if (!session) return;
  const url = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  if (url.includes('/impersonate') || url.endsWith('/stop-impersonation')) {
    throw new ImpersonationError(403, 'Cannot start another impersonation from this session.', 'nested_impersonation');
  }
  if (/\/password\b|password-reset|reset-link|reset-token/.test(url) || url.includes('/api/super-admin')) {
    throw new ImpersonationError(403, 'Passwords, company billing, and API secrets stay on the Superadmin pages.', 'sensitive_blocked');
  }
  if (session.viewOnly && !WRITE_ALLOWLIST.some((path) => url === path || url.endsWith(path))) {
    throw new ImpersonationError(403, 'View only mode cannot change data.', 'view_only');
  }
}

export async function loadImpersonation(claims: TokenClaims): Promise<ImpersonationState | null> {
  if (!claims.isImpersonation) return null;
  if (!claims.impersonationId || !claims.impersonatedBy) {
    throw new ImpersonationError(401, 'Impersonation session is invalid.', 'impersonation_invalid');
  }
  const session = await prisma.impersonationSession.findUnique({ where: { id: claims.impersonationId } });
  if (!session || session.endedAt || session.superadminId !== claims.impersonatedBy || session.actingAsUserId !== claims.id || session.tenantId !== claims.tenantId) {
    throw new ImpersonationError(401, 'Impersonation session has ended.', 'impersonation_ended');
  }
  if (session.hardExpiresAt.getTime() <= Date.now()) {
    await endImpersonation(session.id, 'expired');
    throw new ImpersonationError(401, 'Impersonation session has expired.', 'impersonation_expired');
  }
  const superadmin = await prisma.user.findUnique({
    where: { id: session.superadminId },
    select: { isActive: true, isSuperAdmin: true },
  });
  if (!superadmin?.isActive || !superadmin.isSuperAdmin) {
    await endImpersonation(session.id, 'disabled');
    throw new ImpersonationError(401, 'The Superadmin account is unavailable.', 'superadmin_unavailable');
  }
  void prisma.impersonationSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date() },
  }).catch(() => undefined);
  return {
    id: session.id,
    superadminId: session.superadminId,
    tenantId: session.tenantId,
    actingAsUserId: session.actingAsUserId,
    viewOnly: session.viewOnly,
    allowInactive: session.allowInactive,
    hardExpiresAt: session.hardExpiresAt,
    returnPath: session.returnPath,
  };
}

async function listAdmins(tenantId: string): Promise<ImpersonationAdmin[]> {
  const users = await prisma.user.findMany({
    where: { tenantId, isActive: true, isSuperAdmin: false, profile: { isAdmin: true } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profile: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return users.map((user) => ({
    id: user.id,
    name: displayName(user),
    email: user.email,
    profileName: user.profile?.name || 'Admin',
  }));
}

export async function startImpersonation(input: {
  superadminId: string;
  tenantId: string;
  loginAt?: number;
  adminUserId?: string;
  viewOnly: boolean;
  confirmInactive: boolean;
  password?: string;
  ip?: string;
  userAgent?: string;
}) {
  if (input.loginAt == null || Date.now() - input.loginAt > IMPERSONATION_REAUTH_MS) {
    if (!input.password) {
      throw new ImpersonationError(403, 'Re-enter your password to open this company.', 'reauth_required');
    }
    const superadmin = await prisma.user.findUnique({
      where: { id: input.superadminId },
      select: { passwordHash: true, isActive: true, isSuperAdmin: true },
    });
    if (!superadmin?.isActive || !superadmin.isSuperAdmin || !(await bcrypt.compare(input.password, superadmin.passwordHash))) {
      throw new ImpersonationError(403, 'Password does not match this Superadmin.', 'reauth_required');
    }
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, name: true, isActive: true, companyStartDate: true, companyExpiryDate: true },
  });
  if (!tenant) throw new ImpersonationError(404, 'Company not found.', 'not_found');
  const blocked = companyAccessBlock(tenant);
  if (blocked && !input.confirmInactive) {
    throw new ImpersonationError(409, `${blocked} Confirm to open it anyway.`, 'company_inactive');
  }

  const admins = await listAdmins(tenant.id);
  if (!admins.length) {
    throw new ImpersonationError(409, 'This company has no active admin user.', 'no_admin');
  }
  const actingAs = input.adminUserId
    ? admins.find((admin) => admin.id === input.adminUserId)
    : admins.length === 1 ? admins[0] : undefined;
  if (!actingAs) {
    throw new ImpersonationError(409, 'Choose which admin to open.', 'choose_admin', admins);
  }

  const open = await prisma.impersonationSession.count({
    where: { superadminId: input.superadminId, endedAt: null, hardExpiresAt: { gt: new Date() } },
  });
  if (open >= MAX_CONCURRENT_IMPERSONATIONS) {
    throw new ImpersonationError(429, 'You already have 3 open company sessions. Exit one before opening another.', 'too_many_sessions');
  }

  const actingUser = await prisma.user.findFirst({
    where: { id: actingAs.id, tenantId: tenant.id, isActive: true, isSuperAdmin: false },
    select: { id: true, email: true, tenantId: true, isSuperAdmin: true },
  });
  if (!actingUser) throw new ImpersonationError(409, 'This company has no active admin user.', 'no_admin');

  const now = new Date();
  const session = await prisma.impersonationSession.create({
    data: {
      superadminId: input.superadminId,
      tenantId: tenant.id,
      actingAsUserId: actingUser.id,
      viewOnly: input.viewOnly,
      allowInactive: Boolean(blocked),
      hardExpiresAt: new Date(now.getTime() + IMPERSONATION_HARD_CAP_MS),
      returnPath: `/admin/companies/${tenant.id}`,
      superadminLoginAt: new Date(input.loginAt || now.getTime()),
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });

  const superadmin = await prisma.user.findUnique({
    where: { id: input.superadminId },
    select: { firstName: true, lastName: true, email: true },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: actingUser.id,
      impersonatedById: input.superadminId,
      action: 'IMPERSONATION_STARTED',
      objectType: 'ImpersonationSession',
      objectId: session.id,
      newValues: {
        viewOnly: input.viewOnly,
        superadminName: superadmin ? displayName(superadmin) : 'Superadmin',
        actingAsName: actingAs.name,
      },
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
  });

  const setting = await prisma.tenantImpersonationSetting.findUnique({ where: { tenantId: tenant.id } });
  const notify = setting?.notifyOnAccess !== false;
  if (notify) {
    const alreadyNotified = await prisma.impersonationSession.findFirst({
      where: { tenantId: tenant.id, notifySentAt: { gte: kolkataDayStart(now) }, id: { not: session.id } },
      select: { id: true },
    });
    if (!alreadyNotified) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          tenantId: tenant.id,
          userId: admin.id,
          title: 'Superadmin access',
          message: `A Superadmin opened ${tenant.name} as ${actingAs.name}.`,
          type: 'IMPERSONATION',
          referenceId: session.id,
          referenceType: 'ImpersonationSession',
        })),
      });
      await prisma.impersonationSession.update({
        where: { id: session.id },
        data: { notifySentAt: now },
      });
    }
  }

  return { session, actingUser, actingAs, tenantName: tenant.name };
}

export async function exitImpersonation(sessionId: string) {
  const session = await prisma.impersonationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.endedAt) {
    throw new ImpersonationError(401, 'Impersonation session has ended.', 'impersonation_ended');
  }
  const superadmin = await prisma.user.findUnique({
    where: { id: session.superadminId },
    select: { id: true, email: true, tenantId: true, isSuperAdmin: true, isActive: true, firstName: true, lastName: true },
  });
  await endImpersonation(session.id, 'exit');
  await prisma.auditLog.create({
    data: {
      tenantId: session.tenantId,
      userId: session.actingAsUserId,
      impersonatedById: session.superadminId,
      action: 'IMPERSONATION_ENDED',
      objectType: 'ImpersonationSession',
      objectId: session.id,
      newValues: { endReason: 'exit', superadminName: superadmin ? displayName(superadmin) : 'Superadmin' },
    },
  });
  if (!superadmin?.isActive || !superadmin.isSuperAdmin) {
    throw new ImpersonationError(401, 'The Superadmin account is unavailable.', 'superadmin_unavailable');
  }
  return { superadmin, loginAt: session.superadminLoginAt.getTime(), returnPath: session.returnPath };
}

export async function impersonationStatus(req: AuthRequest) {
  const session = req.impersonation;
  if (!session) return { active: false as const };
  const [tenant, acting, superadmin] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } }),
    prisma.user.findUnique({
      where: { id: session.actingAsUserId },
      select: { firstName: true, lastName: true, profile: { select: { name: true } } },
    }),
    prisma.user.findUnique({
      where: { id: session.superadminId },
      select: { firstName: true, lastName: true },
    }),
  ]);
  return {
    active: true as const,
    tenantId: session.tenantId,
    tenantName: tenant?.name || 'Company',
    actingAsName: acting ? displayName(acting) : 'Admin',
    profileName: acting?.profile?.name || 'Admin',
    superadminName: superadmin ? displayName(superadmin) : 'Superadmin',
    viewOnly: session.viewOnly,
    hardExpiresAt: session.hardExpiresAt.toISOString(),
    returnPath: session.returnPath,
  };
}

export async function listImpersonationLog(tenantId: string) {
  const sessions = await prisma.impersonationSession.findMany({
    where: { tenantId },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  const userIds = [...new Set(sessions.flatMap((session) => [session.superadminId, session.actingAsUserId]))];
  const users = userIds.length
    ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, profile: { select: { name: true } } },
    })
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  return sessions.map((session) => {
    const ended = session.endedAt?.getTime() || Date.now();
    const actor = byId.get(session.superadminId);
    const acting = byId.get(session.actingAsUserId);
    return {
      id: session.id,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() || null,
      endReason: session.endReason,
      viewOnly: session.viewOnly,
      durationMs: Math.max(0, ended - session.startedAt.getTime()),
      superadmin: { id: session.superadminId, name: actor ? displayName(actor) : 'Superadmin' },
      actingAs: {
        id: session.actingAsUserId,
        name: acting ? displayName(acting) : 'Admin',
        profileName: acting?.profile?.name || 'Admin',
      },
    };
  });
}

export async function getNotifySetting(tenantId: string) {
  const setting = await prisma.tenantImpersonationSetting.findUnique({ where: { tenantId } });
  return { notifyOnAccess: setting?.notifyOnAccess !== false };
}

export async function setNotifySetting(tenantId: string, notifyOnAccess: boolean) {
  await prisma.tenantImpersonationSetting.upsert({
    where: { tenantId },
    create: { tenantId, notifyOnAccess },
    update: { notifyOnAccess },
  });
  return { notifyOnAccess };
}

export function requestMeta(req: Request) {
  return {
    ip: requestIp(req),
    userAgent: req.get('user-agent') || undefined,
  };
}

export function installResponseRedaction(req: AuthRequest, res: Response) {
  if (!req.impersonation || res.locals.__impersonationRedacted) return;
  res.locals.__impersonationRedacted = true;
  const original = res.json.bind(res);
  res.json = ((body: unknown) => original(redactSecrets(body))) as Response['json'];
}
