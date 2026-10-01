import { defineConfig } from 'vitest/config';

// Full suite: unit + integration (integration tests need TEST_DATABASE_URL; the DB is wiped).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
