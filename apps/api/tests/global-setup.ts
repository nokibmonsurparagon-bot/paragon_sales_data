import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/** Applies migrations to the disposable test database once per run. */
export default function setup(): void {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  config({ path: path.resolve(apiRoot, '../../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example). Use `npm run test:unit` for DB-free tests.');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL – the test DB is wiped.');
  execSync('npx prisma migrate deploy', { cwd: apiRoot, stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
