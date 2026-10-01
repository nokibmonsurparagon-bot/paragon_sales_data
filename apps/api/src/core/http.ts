import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { ApiSuccess } from '@paragon/shared';
import { getContext } from './context.js';
import { AuthenticationError } from './errors.js';
import type { AuthenticatedUser } from './context.js';

export function requestId(): string {
  return getContext()?.requestId ?? 'unknown';
}

export function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = { success: true, data, requestId: requestId() };
  if (message) body.message = message;
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T, message?: string): void {
  ok(res, data, message, 201);
}

/** Zod-parse helpers. A ZodError is translated to HTTP 400 by the error handler. */
export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.query);
}

export function parseParams<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.params);
}

export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export function sortOrder<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  fallback: { field: F; dir: 'asc' | 'desc' },
): { field: F; dir: 'asc' | 'desc' } {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  return (allowed as readonly string[]).includes(field) ? { field: field as F, dir } : fallback;
}

export function pageArgs(q: { page: number; limit: number }): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}
