import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Single .env at the repository root (also used by docker-compose). Real env vars take precedence.
config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
});
