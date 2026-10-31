import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@dct-crm/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ApiKeyAuthError, ApiKeyEncryptionError, DELETE_API_SCOPES, generateCompanyApiKey, getCompanyApiKey, getSetupCompanyApiKey, revealCompanyApiKey, revealSetupCompanyApiKey, revokeCompanyApiKey, rotateCompanyApiKey, updateCompanyApiKeyHeaderSettings, updateCompanyApiKeyScopes } from '../services/apiKeys';

const superAdminRouter = Router({ mergeParams: true });
const setupRouter = Router();

function noStore(_req: AuthRequest, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.apiKey && req.user?.isSuperAdmin) return next();
  return res.status(403).json({ success: false, error: 'Super Admin access is required' });
}

function requireCompanyAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.apiKey && !req.user?.isSuperAdmin && req.user?.isAdmin && !req.impersonation && !req.user.impersonatedBy) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Company Admin access is required' });
}

function setupTenantId(req: AuthRequest) {
  return req.user!.tenantId;
}

function rejectForeignSetupTenant(req: AuthRequest, res: Response, next: NextFunction) {
  const requested = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
  if (requested && !req.user?.isSuperAdmin && requested !== req.user?.tenantId) {
    return res.status(403).json({ success: false, error: "You cannot access another company's API key" });
  }
  return next();
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ApiKeyAuthError) {
    return res.status(error.status).json({ success: false, error: error.message, code: error.code });
  }
  if (error instanceof ApiKeyEncryptionError) {
    return res.status(503).json({ success: false, error: error.message, code: 'API_KEY_ENCRYPTION_UNAVAILABLE' });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid request' });
  }
  console.error('Company API key operation failed:', error instanceof Error ? error.name : 'unknown error');
  return res.status(500).json({ success: false, error: 'Failed to manage the company API key' });
}

async function writeKeyAudit(
  tenantId: string,
  userId: string,
  action: string,
  keyId: string,
  ipAddress: string | undefined,
  details: Record<string, unknown> = {},
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action,
      objectType: 'ApiKey',
      objectId: keyId,
      newValues: {
        companyId: tenantId,
        companyName: tenant?.name || null,
        occurredAt: new Date().toISOString(),
        ...details,
      },
      ipAddress,
    },
  });
}

superAdminRouter.use(authenticate, requireSuperAdmin);

superAdminRouter.get('/', noStore, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getCompanyApiKey(String(req.params.tenantId));
    return res.json({
      success: true,
      data: { ...data, maskedKey: data.apiKey ? 'dct_live_••••••••' : null },
    });
  } catch (error) {
    sendError(res, error);
  }
});

const revealRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const revealSchema = z.object({
  password: z.string().min(1).max(256),
  purpose: z.enum(['show', 'copy']).default('show'),
});

superAdminRouter.post('/reveal', noStore, revealRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { password, purpose } = revealSchema.parse(req.body || {});
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { passwordHash: true, isSuperAdmin: true, isActive: true },
    });
    if (!user?.isSuperAdmin || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, error: 'Password verification failed' });
    }

    const tenantId = String(req.params.tenantId);
    const revealed = await revealCompanyApiKey(tenantId);
    await writeKeyAudit(
      tenantId,
      req.user!.id,
      purpose === 'copy' ? 'API_KEY_COPIED' : 'API_KEY_REVEALED',
      revealed.record.id,
      req.ip,
    );
    return res.json({ success: true, data: revealed.record, apiKey: revealed.apiKey });
  } catch (error) {
    return sendError(res, error);
  }
});

superAdminRouter.post('/generate', noStore, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = String(req.params.tenantId);
    const generated = await generateCompanyApiKey(tenantId, req.user!.id);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_GENERATED', generated.record.id, req.ip);
    return res.status(201).json({ success: true, data: generated.record });
  } catch (error) {
    return sendError(res, error);
  }
});

superAdminRouter.post('/rotate', noStore, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = String(req.params.tenantId);
    const current = await getCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const rotated = await rotateCompanyApiKey(tenantId, current.apiKey.id, req.user!.id);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_ROTATED', rotated.record.id, req.ip);
    return res.json({ success: true, data: rotated.record });
  } catch (error) {
    return sendError(res, error);
  }
});

superAdminRouter.post('/revoke', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = String(req.params.tenantId);
    const current = await getCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const revoked = await revokeCompanyApiKey(tenantId, current.apiKey.id);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_REVOKED', revoked.id, req.ip);
    return res.json({ success: true, data: revoked });
  } catch (error) {
    return sendError(res, error);
  }
});

const scopesSchema = z.object({
  allowDelete: z.boolean(),
});
const headerSettingsSchema = z.object({
  customHeaderName: z.string().nullable(),
  acceptOnlyCustomHeader: z.boolean(),
});

async function saveHeaderSettings(tenantId: string, keyId: string, userId: string, body: unknown, ipAddress?: string) {
  const { customHeaderName, acceptOnlyCustomHeader } = headerSettingsSchema.parse(body);
  const normalizedHeaderName = customHeaderName?.trim() || null;
  const updated = await updateCompanyApiKeyHeaderSettings(tenantId, keyId, normalizedHeaderName, acceptOnlyCustomHeader);
  await writeKeyAudit(tenantId, userId, 'API_KEY_HEADER_SETTINGS_UPDATED', keyId, ipAddress, {
    customHeaderName: normalizedHeaderName,
    acceptOnlyCustomHeader,
  });
  return updated;
}

superAdminRouter.patch('/header-settings', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = String(req.params.tenantId);
    const current = await getCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const updated = await saveHeaderSettings(tenantId, current.apiKey.id, req.user!.id, req.body || {}, req.ip);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return sendError(res, error);
  }
});

superAdminRouter.patch('/scopes', async (req: AuthRequest, res: Response) => {
  try {
    const { allowDelete } = scopesSchema.parse(req.body || {});
    const tenantId = String(req.params.tenantId);
    const current = await getCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const scopes = allowDelete
      ? [...new Set([...current.apiKey.scopes, ...DELETE_API_SCOPES])]
      : current.apiKey.scopes.filter((scope) => !DELETE_API_SCOPES.includes(scope));
    const updated = await updateCompanyApiKeyScopes(tenantId, current.apiKey.id, scopes);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_SCOPES_UPDATED', updated.id, req.ip);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.use(authenticate, requireCompanyAdmin, rejectForeignSetupTenant);
setupRouter.get('/api-key', noStore, async (req: AuthRequest, res: Response) => {
  try {
    return res.json({ success: true, data: await getSetupCompanyApiKey(setupTenantId(req)) });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.post('/api-key/reveal-once', noStore, async (req: AuthRequest, res: Response) => {
  try {
    const revealed = await revealSetupCompanyApiKey(setupTenantId(req), req.user!.id, req.ip);
    return res.json({ success: true, data: revealed.record, apiKey: revealed.apiKey });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.post('/api-key/rotate', noStore, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = setupTenantId(req);
    const current = await getSetupCompanyApiKey(tenantId);
    if (!current.apiKey) {
      return res.status(404).json({ success: false, error: 'No API key exists for this company. Ask a Super Admin to generate one.' });
    }
    const rotated = await rotateCompanyApiKey(tenantId, current.apiKey.id, req.user!.id);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_ROTATED', rotated.record.id, req.ip);
    return res.json({ success: true, data: rotated.record });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.post('/api-key/revoke', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = setupTenantId(req);
    const current = await getSetupCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const revoked = await revokeCompanyApiKey(tenantId, current.apiKey.id);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_REVOKED', revoked.id, req.ip);
    return res.json({ success: true, data: revoked });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.patch('/api-key/scopes', async (req: AuthRequest, res: Response) => {
  try {
    const { allowDelete } = scopesSchema.parse(req.body || {});
    const tenantId = setupTenantId(req);
    const current = await getSetupCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const scopes = allowDelete
      ? [...new Set([...current.apiKey.scopes, ...DELETE_API_SCOPES])]
      : current.apiKey.scopes.filter((scope) => !DELETE_API_SCOPES.includes(scope));
    const updated = await updateCompanyApiKeyScopes(tenantId, current.apiKey.id, scopes);
    await writeKeyAudit(tenantId, req.user!.id, 'API_KEY_SCOPES_UPDATED', updated.id, req.ip);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return sendError(res, error);
  }
});

setupRouter.patch('/api-key/header-settings', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = setupTenantId(req);
    const current = await getSetupCompanyApiKey(tenantId);
    if (!current.apiKey) return res.status(404).json({ success: false, error: 'No API key exists for this company' });
    const updated = await saveHeaderSettings(tenantId, current.apiKey.id, req.user!.id, req.body || {}, req.ip);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return sendError(res, error);
  }
});

export { setupRouter as setupCompanyApiKeyRouter };
export default superAdminRouter;
