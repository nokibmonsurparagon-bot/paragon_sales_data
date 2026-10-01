import pino from 'pino';
import { env } from '../config/env.js';

/** Structured logger. Secrets are redacted wherever they may appear. */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'paragon-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  // Human-readable logs in development only; JSON everywhere else (log shippers expect JSON).
  ...(env.NODE_ENV === 'development' && process.env.LOG_FORMAT !== 'json'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' } } }
    : {}),
});
