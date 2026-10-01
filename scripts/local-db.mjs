// Local PostgreSQL for machines without Docker.
// Runs a real PostgreSQL 17 server from npm (embedded-postgres), persisted under .local/pgdata.
// Usage: npm run db:start   (Ctrl+C to stop)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const envPath = path.join(root, '.env');
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = { ...readEnv(), ...process.env };
const dbUrl = new URL(env.DATABASE_URL ?? 'postgresql://paragon:paragon_dev_password@localhost:5432/paragon');
const testUrl = env.TEST_DATABASE_URL ? new URL(env.TEST_DATABASE_URL) : null;
const dataDir = path.join(root, '.local', 'pgdata');
const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  port: Number(dbUrl.port || 5432),
  persistent: true,
  // Force UTF-8 regardless of the OS locale (Windows would otherwise default to WIN1252).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (firstRun) {
  console.log('Initialising local PostgreSQL cluster in .local/pgdata ...');
  await pg.initialise();
}
await pg.start();

for (const name of [dbUrl.pathname.slice(1), testUrl?.pathname.slice(1)].filter(Boolean)) {
  try {
    await pg.createDatabase(name);
    console.log(`Created database "${name}"`);
  } catch {
    // already exists
  }
}

console.log(`PostgreSQL ready on port ${dbUrl.port || 5432}. Press Ctrl+C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping PostgreSQL ...');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
