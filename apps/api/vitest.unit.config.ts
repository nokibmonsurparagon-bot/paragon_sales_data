import { defineConfig } from 'vitest/config';

// Unit tests only – no database required.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
  },
});
