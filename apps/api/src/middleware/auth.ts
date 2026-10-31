import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '@dct-crm/db';
import { EffectivePermission } from '../services/effectivePermissions';
import { requestIp } from '../services/apiKeys';
import { impersonationStore } from '../services/impersonationContext';
import {
  ImpersonationError,
  ImpersonationState,
  assertImpersonationRequestAllowed,
  installResponseRedaction,
  loadImpersonation,
} from '../services/impersonation';
import { sessionIsAccepted } from '../services/userPresence';
import { auditLog } from './audit';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    isSuperAdmin: boolean;
    impersonatedBy?: string;
    profileId?: string;
    profileName?: string;
    isAdmin?: boolean;
  };
  tenantId?: string;
  sessionLoginAt?: number;
  sessionSecret?: string;
  tokenExpiresAt?: number;
  impersonation?: ImpersonationState;
  apiKey?: {
    id: string;
    tenantId: string;
    scopes: string[];
  };
  effectivePermissions?: EffectivePermission[];
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.apiKey && req.user && req.tenantId) return next();
    const authorizationHeader = req.headers.authorization;
    const browserSessionRequired = req.headers['x-session-auth'] === 'required';
    const token = authorizationHeader?.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length)
      : browserSessionRequired
        ? undefined
        : req.cookies?.token;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      tenantId: string;
      isSuperAdmin: boolean;
      impersonatedBy?: string;
      loginAt?: number;
      sid?: string;
      isImpersonation?: boolean;
      impersonationId?: string;
      exp?: number;
    };
    req.sessionLoginAt = typeof decoded.loginAt === 'number' ? decoded.loginAt : undefined;
    req.sessionSecret = typeof decoded.sid === 'string' ? decoded.sid : undefined;
    req.tokenExpiresAt = typeof decoded.exp === 'number' ? decoded.exp : undefined;
    if (req.sessionSecret && !(await sessionIsAccepted(req.sessionSecret))) {
      return res.status(401).json({ success: false, error: 'Session ended' });
    }
    if (decoded.isImpersonation) {
      const loaded = await loadImpersonation(decoded);
      if (loaded) req.impersonation = loaded;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true, email: true, tenantId: true, isActive: true, isSuperAdmin: true,
        profileId: true,
        profile: { select: { id: true, name: true, isAdmin: true } },
        tenant: { select: { isActive: true, companyStartDate: true, companyExpiryDate: true } },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    let tenantId = user.tenantId;
    const requestedTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
    if (req.impersonation) {
      if (user.tenantId !== req.impersonation.tenantId || user.id !== req.impersonation.actingAsUserId) {
        return res.status(401).json({ success: false, error: 'Impersonation session has ended.' });
      }
      if (requestedTenant && requestedTenant !== req.impersonation.tenantId) {
        return res.status(403).json({ success: false, error: 'tenantId does not match this session' });
      }
      tenantId = req.impersonation.tenantId;
    } else if (requestedTenant) {
      if (!user.isSuperAdmin && requestedTenant !== user.tenantId) {
        return res.status(403).json({ success: false, error: 'tenantId does not match this session' });
      }
      if (user.isSuperAdmin) {
        const selectedTenant = await prisma.tenant.findUnique({
          where: { id: requestedTenant },
          select: { id: true },
        });
        if (!selectedTenant) {
          return res.status(404).json({ success: false, error: 'Company not found' });
        }
        tenantId = selectedTenant.id;
        if (requestedTenant !== user.tenantId) {
          await auditLog(selectedTenant.id, user.id, 'SUPERADMIN_TENANT_ACCESS', 'Tenant', selectedTenant.id, undefined, {
            method: req.method,
            path: (req.originalUrl || req.url || '').split('?')[0],
          }, requestIp(req));
        }
      }
    }

    const allowInactive = Boolean(req.impersonation?.allowInactive);
    if (!user.tenant.isActive && !allowInactive) {
      return res.status(403).json({ success: false, error: 'Company is inactive. Contact Super Admin.' });
    }

    if (!user.isSuperAdmin && !allowInactive) {
      const now = new Date();
      if (user.tenant.companyStartDate && now < user.tenant.companyStartDate) {
        return res.status(403).json({ success: false, error: 'Company has not started yet. Access begins on ' + user.tenant.companyStartDate.toLocaleDateString() + '.' });
      }
      if (user.tenant.companyExpiryDate && now > user.tenant.companyExpiryDate) {
        return res.status(403).json({ success: false, error: 'Company subscription has expired. Contact Super Admin.' });
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      tenantId: req.impersonation ? req.impersonation.tenantId : user.tenantId,
      isSuperAdmin: req.impersonation ? false : user.isSuperAdmin,
      impersonatedBy: decoded.impersonatedBy,
      profileId: user.profileId || user.profile?.id || undefined,
      profileName: user.profile?.name || undefined,
      isAdmin: user.profile?.isAdmin || false,
    };
    req.tenantId = tenantId;
    assertImpersonationRequestAllowed(req);
    installResponseRedaction(req, res);
    if (req.impersonation) {
      return impersonationStore.run({ impersonatedById: req.impersonation.superadminId }, () => next());
    }
    next();
  } catch (error) {
    if (error instanceof ImpersonationError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

export const generateToken = (
  user: {
    id: string;
    email: string;
    tenantId: string;
    isSuperAdmin: boolean;
    impersonatedBy?: string;
    loginAt?: number;
    sessionId?: string;
    isImpersonation?: boolean;
    impersonationId?: string;
    viewOnly?: boolean;
  },
  expiresIn: SignOptions['expiresIn'] = '15m',
) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
      impersonatedBy: user.impersonatedBy,
      loginAt: user.loginAt,
      sid: user.sessionId,
      isImpersonation: user.isImpersonation,
      impersonationId: user.impersonationId,
      viewOnly: user.viewOnly,
    },
    process.env.JWT_SECRET!,
    { expiresIn },
  );
};