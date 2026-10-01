import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config → apps/api ; dist/src/config (compiled) → apps/api
const apiRoot = path.resolve(here, here.split(path.sep).includes('dist') ? '../../..' : '../..');
// Root .env first (shared with docker-compose); real environment variables always win.
config({ path: [path.resolve(apiRoot, '../../.env'), path.resolve(apiRoot, '.env')], quiet: true });

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  COOKIE_SECURE: bool(true),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  FILE_STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Fail fast: never boot with missing or weak secrets.
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

const e = parsed.data;

if (e.NODE_ENV === 'production') {
  // Refuse to boot with the placeholder secrets from .env.example or identical secrets.
  const weak = [e.JWT_SECRET, e.JWT_REFRESH_SECRET].some((s) => s.startsWith('change-me'));
  if (weak || e.JWT_SECRET === e.JWT_REFRESH_SECRET) {
    console.error('Refusing to start: JWT secrets must be unique, random values in production.');
    process.exit(1);
  }
  if (!e.COOKIE_SECURE) {
    console.warn('WARNING: COOKIE_SECURE=false in production – refresh cookies will be sent over plain HTTP.');
  }
}

export const env = {
  ...e,
  isProduction: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  swaggerEnabled: e.SWAGGER_ENABLED ? e.SWAGGER_ENABLED === 'true' : e.NODE_ENV !== 'production',
  fileStoragePath: path.isAbsolute(e.FILE_STORAGE_PATH)
    ? e.FILE_STORAGE_PATH
    : path.resolve(apiRoot, e.FILE_STORAGE_PATH),
};

export type Env = typeof env;
