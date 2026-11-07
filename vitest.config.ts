import { defineConfig } from 'vitest/config';

// One project per workspace plus the repo-level checks in tools/. Fixtures are data, never test files.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', { test: { name: 'tools', include: ['tools/*.test.ts'] } }],
    // One fresh test database per run, for every project (tools/test-database.ts).
    globalSetup: ['tools/test-database.ts'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**', 'packages/*/src/**', 'packages/db/views/**', 'tools/**/*.ts'],
      exclude: ['tools/boundary-fixtures/**', '**/*.test.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
    },
  },
});
