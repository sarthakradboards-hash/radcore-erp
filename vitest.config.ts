import { defineConfig } from 'vitest/config';

// One project per workspace plus the repo-level checks in tools/. Fixtures are data, never test files.
export default defineConfig({
  test: {
    // tools' setup fails the run on a route's undeclared error code (RAD-134). Its database tests share one database,
    // so a save that draws a journal number, or takes the books' turn, waits behind another file's rolled-back books
    // transaction (tools/books-turn.ts); under CI's coverage that wait passed 5 s (RAD-76: sales-amounts on #355,
    // average-cost on #369), so they get 20 s.
    projects: ['packages/*', 'apps/*',
      { test: { name: 'tools', include: ['tools/*.test.ts'], setupFiles: ['tools/vitest-setup.ts'], testTimeout: 20_000 } }],
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
