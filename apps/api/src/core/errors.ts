import { ERROR_CODES, type ApiErrorDetail, type ErrorCode } from '@paragon/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details: ApiErrorDetail[] = []) {
    super(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ERROR_CODES.AUTHENTICATION_REQUIRED) {
    super(401, code, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action', code: ErrorCode = ERROR_CODES.FORBIDDEN, details: ApiErrorDetail[] = []) {
    super(403, code, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Resource') {
    super(404, ERROR_CODES.NOT_FOUND, `${entity} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource was modified by someone else. Reload and try again.', code: ErrorCode = ERROR_CODES.VERSION_CONFLICT, details: ApiErrorDetail[] = []) {
    super(409, code, message, details);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.BUSINESS_RULE_VIOLATION, details: ApiErrorDetail[] = []) {
    super(422, code, message, details);
  }
}

export class PayloadError extends AppError {
  constructor(status: 413 | 415, code: ErrorCode, message: string) {
    super(status, code, message);
  }
}
