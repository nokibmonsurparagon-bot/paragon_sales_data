import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiErrorDetail, type ApiFailure } from '@paragon/shared';
import { AppError } from './errors.js';
import { logger } from './logger.js';

function failure(requestId: string, code: string, message: string, details: ApiErrorDetail[] = []): ApiFailure {
  return { success: false, error: { code, message, details }, requestId };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(failure(req.requestId, ERROR_CODES.NOT_FOUND, `Route ${req.method} ${req.path} not found`));
};

/**
 * Central error mapping. Stack traces and internal messages are logged, never returned.
 * 400 validation · 401 authentication · 403 authorization · 404 not found · 409 conflict · 422 business rule · 500
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = req.requestId ?? 'unknown';
  if (res.headersSent) {
    // Failure mid-stream (e.g. report export): the status is already sent, so just terminate.
    logger.error({ err, requestId, path: req.path }, 'Error after response started');
    res.destroy();
    return;
  }
  let status = 500;
  let body: ApiFailure;

  if (err instanceof AppError) {
    status = err.status;
    body = failure(requestId, err.code, err.message, err.details);
  } else if (err instanceof ZodError) {
    status = 400;
    body = failure(
      requestId,
      ERROR_CODES.VALIDATION_ERROR,
      'Validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    );
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    status = 409;
    const target = (err.meta?.target as string[] | string | undefined) ?? [];
    const fields = Array.isArray(target) ? target : [target];
    body = failure(
      requestId,
      ERROR_CODES.DUPLICATE_KEY,
      `A record with the same ${fields.join(', ') || 'value'} already exists`,
      fields.map((f) => ({ path: f, message: 'Must be unique' })),
    );
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    status = 404;
    body = failure(requestId, ERROR_CODES.NOT_FOUND, 'Resource not found');
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    body = failure(
      requestId,
      err.code === 'LIMIT_FILE_SIZE' ? ERROR_CODES.FILE_TOO_LARGE : ERROR_CODES.VALIDATION_ERROR,
      err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload error: ${err.message}`,
    );
  } else if (isBodyParserError(err)) {
    status = err.status;
    body = failure(
      requestId,
      ERROR_CODES.VALIDATION_ERROR,
      err.type === 'entity.too.large' ? 'Request body too large' : 'Malformed JSON body',
    );
  } else {
    body = failure(requestId, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred. Please contact support with the request id.');
  }

  if (status >= 500) {
    logger.error({ err, requestId, path: req.path, method: req.method }, 'Unhandled error');
  } else {
    logger.info({ requestId, code: body.error.code, status, path: req.path }, 'Request failed');
  }
  res.status(status).json(body);
};

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported'].includes(String((err as { type: unknown }).type))
  );
}
