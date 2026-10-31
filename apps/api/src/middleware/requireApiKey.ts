import type { NextFunction, Response } from 'express';
import type { Application, RequestHandler } from 'express';
import { AuthRequest } from './auth';
import { authenticate } from './auth';
import {
  ApiKeyAuthError,
  apiKeyErrorBody,
  attachApiKeyRequestLog,
  authenticatePresentedApiKey,
  presentedApiKey,
} from '../services/apiKeys';

function queryCarriesKey(req: AuthRequest) {
  const names = new Set(['apikey', 'api_key', 'key', 'token', 'access_token']);
  return Object.keys(req.query).some((name) => names.has(name.toLowerCase()));
}

function bodyCarriesKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(bodyCarriesKey);
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.some(([name, nested]) =>
    ['apikey', 'api_key'].includes(name.toLowerCase()) || bodyCarriesKey(nested),
  );
}

export function requireApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  if (queryCarriesKey(req) || bodyCarriesKey(req.body)) {
    attachApiKeyRequestLog(req, res);
    return res.status(401).json({
      ok: false,
      code: 'API_KEY_INVALID',
      message: 'API key is invalid.',
    });
  }

  const presented = presentedApiKey(req);
  if (presented) {
    return authenticatePresentedApiKey(req, res, presented.apiKey, presented.headerName)
      .then((authenticated) => {
        req.user = authenticated.user;
        req.tenantId = authenticated.record.tenantId;
        req.apiKey = {
          id: authenticated.record.id,
          tenantId: authenticated.record.tenantId,
          scopes: authenticated.record.scopes,
        };
        return next();
      })
      .catch((error: unknown) => {
        attachApiKeyRequestLog(req, res);
        if (error instanceof ApiKeyAuthError) {
          if (error.status === 429) res.setHeader('Retry-After', '60');
          return res.status(error.status).json(apiKeyErrorBody(error));
        }
        console.error('API key authentication error:', error);
        return res.status(500).json({ ok: false, code: 'API_KEY_INVALID', message: 'API key is invalid.' });
      });
  }

  const authorization = req.headers.authorization;
  const hasBrowserSession = Boolean(
    (authorization?.startsWith('Bearer ') && !authorization.slice('Bearer '.length).trim().startsWith('dct_'))
    || req.headers['x-session-auth'] === 'required'
    || req.cookies?.token,
  );
  if (hasBrowserSession) return authenticate(req, res, next);

  attachApiKeyRequestLog(req, res);
  return res.status(401).json({
    ok: false,
    code: 'API_KEY_MISSING',
    message: 'An API key is required.',
  });
}

export const EXTERNAL_API_MOUNTS = [
  { path: '/api/leads', resource: 'leads' },
  { path: '/api/enquiries', resource: 'enquiries' },
  { path: '/api/site-visits', resource: 'site-visits' },
  { path: '/api/bookings', resource: 'bookings' },
  { path: '/api/projects', resource: 'projects' },
  { path: '/api/units', resource: 'units' },
  { path: '/api/follow-ups', resource: 'follow-ups' },
  { path: '/api/activities', resource: 'activities' },
  { path: '/api/call-details', resource: 'call-details' },
  { path: '/api/quotations', resource: 'quotations' },
  { path: '/api/receipts', resource: 'receipts' },
  { path: '/api/records', resource: 'records' },
  { path: '/api/notes', resource: 'notes' },
] as const;

export function mountExternalApi(app: Application, path: string, router: RequestHandler) {
  app.use(path, requireApiKey, router);
}
