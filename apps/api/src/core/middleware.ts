import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { ERROR_CODES, MASTER_IMPORT_MAX_MB, type ApiFailure, type Permission } from '@paragon/shared';
import { env } from '../config/env.js';
import { loadAuthz } from './authz.js';
import { getContext, hasPermission, runWithContext } from './context.js';
import { AuthenticationError, AuthorizationError } from './errors.js';
import { verifyAccessToken } from './security.js';

/** Assigns a request id (honours a sane incoming X-Request-Id) and opens the async context. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,100}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  runWithContext({ requestId: id, ipAddress: req.ip, userAgent: req.get('user-agent') }, next);
}

/** Verifies the Bearer access token and loads the user's current roles/permissions. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new AuthenticationError();
  const claims = verifyAccessToken(header.slice(7).trim());
  const authz = await loadAuthz(claims.sub);
  if (!authz || authz.status !== 'ACTIVE' || authz.tokenVersion !== claims.tv) {
    throw new AuthenticationError('Your session is no longer valid. Please sign in again.', ERROR_CODES.TOKEN_INVALID);
  }
  // Users with a temporary (admin-set) password may only use the auth endpoints until they change it.
  if (authz.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
    throw new AuthorizationError('You must change your password before continuing', ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
  }
  req.user = authz.user;
  const ctx = getContext();
  if (ctx) ctx.user = authz.user;
  next();
};

/** Allows the request if the user holds ANY of the listed permissions. */
export function requirePermission(...perms: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new AuthenticationError();
    if (!hasPermission(req.user, ...perms)) throw new AuthorizationError();
    next();
  };
}

/**
 * CSRF defence for the only cookie-authenticated endpoints (/auth/refresh, /auth/logout):
 * SameSite=Strict cookie + custom header (not sendable cross-site without CORS preflight) + Origin allow-list.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    throw new AuthorizationError('Missing anti-CSRF header', ERROR_CODES.CSRF_REJECTED);
  }
  const origin = req.get('origin');
  if (origin && !env.CORS_ORIGIN.includes(origin)) {
    throw new AuthorizationError('Origin not allowed', ERROR_CODES.CSRF_REJECTED);
  }
  next();
};

function rateLimited(req: Request, res: Response): void {
  const body: ApiFailure = {
    success: false,
    error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests. Please try again later.', details: [] },
    requestId: req.requestId,
  };
  res.status(429).json(body);
}

export const apiRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimited,
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimited,
});

/** Master-data import file (Excel / CSV), kept in memory and parsed, never stored. */
export const importFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MASTER_IMPORT_MAX_MB * 1024 * 1024, files: 1, fields: 5 },
}).single('file');

/** In-memory upload (single file). Content is validated (magic bytes) before it is stored. */
export const singleFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
}).single('file');
