import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Tests live alongside source under src/ and in the top-level tests/ directory.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // The migration smoke test bootstraps and tears down its own DB schema, which
    // can take longer than the 5 s default when Postgres is cold.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Avoid cross-test parallelism for tests that share a database.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Load .env so DATABASE_URL is available when running locally.
    setupFiles: ['./tests/setup-env.ts'],
  },
});
