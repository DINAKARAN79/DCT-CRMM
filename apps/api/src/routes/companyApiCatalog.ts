import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/superAdmin';
import {
  assertCatalogPath,
  buildCompanyApiCatalog,
  validateCatalogBody,
} from '../services/companyApiCatalog';
import { getPublicApiBaseUrl } from '../services/publicApiBaseUrl';
import { testPublicApiConnectivity } from '../services/publicApiConnectivity';
import { isValidCustomApiKeyHeaderName } from '../services/apiKeys';

const router = Router();
router.use(authenticate);
router.use(requireSuperAdmin);

const trySchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().startsWith('/api/'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  apiKey: z.never().optional(),
  headerName: z.string().min(1).max(64).refine(
    (name) => name.toLowerCase() === 'x-api-key' || name.toLowerCase() === 'authorization' || isValidCustomApiKeyHeaderName(name),
    'Invalid API key header name',
  ),
  sandbox: z.boolean().optional(),
  objectName: z.string().min(1),
  operationId: z.string().min(1),
});

function headerValue(req: AuthRequest, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function resolvedBaseUrl(req: AuthRequest) {
  const trustProxy = req.app.get('trust proxy fn') as ((address: string, index: number) => boolean) | undefined;
  const immediateProxyTrusted = Boolean(trustProxy?.(req.socket.remoteAddress || '', 0));
  return getPublicApiBaseUrl({
    nodeEnv: process.env.NODE_ENV,
    publicBaseUrl: process.env.PUBLIC_API_BASE_URL,
    allowedHosts: process.env.ALLOWED_API_HOSTS,
    trustProxy: immediateProxyTrusted,
    protocol: req.protocol,
    host: req.get('host') || '',
    forwardedProto: immediateProxyTrusted ? headerValue(req, 'x-forwarded-proto') : undefined,
    forwardedHost: immediateProxyTrusted ? headerValue(req, 'x-forwarded-host') : undefined,
  });
}

router.get('/', (req: AuthRequest, res: Response) => {
  const base = resolvedBaseUrl(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: buildCompanyApiCatalog(base.baseUrl) });
});

router.get('/base-url', (req: AuthRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: resolvedBaseUrl(req) });
});

router.get('/base-url/test', async (req: AuthRequest, res: Response) => {
  const base = resolvedBaseUrl(req);
  res.setHeader('Cache-Control', 'no-store');
  if (!base.baseUrl) {
    return res.status(400).json({
      success: true,
      data: { ok: false, status: null, reason: base.warning || 'No valid public API base URL is available.' },
    });
  }
  const result = await testPublicApiConnectivity(base.baseUrl, process.env.NODE_ENV);
  return res.json({ success: true, data: result });
});
router.post('/validate', (req: AuthRequest, res: Response) => {
  const body = z.object({
    objectName: z.string().min(1),
    operationId: z.string().min(1),
    body: z.unknown(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ success: false, error: 'Invalid validation request' });
  res.json({ success: true, data: validateCatalogBody(body.data.objectName, body.data.operationId, body.data.body) });
});

router.post('/try', async (req: AuthRequest, res: Response) => {
  const parsed = trySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid try request' });
  const input = parsed.data;
  if (!assertCatalogPath(input.path)) {
    return res.status(400).json({ success: false, error: 'That path is not in the API catalog' });
  }
  if (input.query && 'tenantId' in input.query) {
    return res.status(400).json({ success: false, error: 'tenantId is not part of this URL' });
  }
  const validation = input.method === 'GET' || input.method === 'DELETE'
    ? { valid: true, fieldErrors: [] as Array<{ field: string; message: string }> }
    : validateCatalogBody(input.objectName, input.operationId, input.body);
  const apiKeyHeader = headerValue(req, input.headerName.toLowerCase());
  if (!validation.valid || input.sandbox || !apiKeyHeader) {
    return res.json({
      success: true,
      data: {
        sandbox: true,
        status: validation.valid ? 200 : 400,
        body: validation.valid ? { success: true, sandbox: true } : { success: false, fieldErrors: validation.fieldErrors },
        fieldErrors: validation.fieldErrors,
        ms: 0,
      },
    });
  }

  const resolved = resolvedBaseUrl(req);
  if (!resolved.baseUrl) {
    return res.status(400).json({ success: false, error: resolved.warning || 'No public API URL is configured.' });
  }
  const url = new URL(
    input.path.replace(/^\/+/, ''),
    `${resolved.baseUrl.replace(/\/+$/, '')}/`,
  );
  if (url.host !== new URL(resolved.baseUrl).host) {
    return res.status(400).json({ success: false, error: 'That path is not in the API catalog' });
  }
  for (const [key, value] of Object.entries(input.query || {})) url.searchParams.set(key, String(value));
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: input.method,
      headers: {
        [input.headerName]: apiKeyHeader,
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.headerName.toLowerCase() === 'authorization' ? {} : { Authorization: '' }),
        ...(input.method === 'POST' || input.method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: input.method === 'GET' || input.method === 'DELETE' ? undefined : JSON.stringify(input.body ?? {}),
    });
    const text = await response.text();
    let responseBody: unknown = text;
    try { responseBody = text ? JSON.parse(text) : null; } catch { responseBody = text; }
    res.json({
      success: true,
      data: { sandbox: false, status: response.status, ms: Date.now() - started, body: responseBody, fieldErrors: [] },
    });
  } catch (error) {
    console.error('API catalog try failed:', error);
    res.status(502).json({ success: false, error: 'The API could not be reached' });
  }
});

export default router;
