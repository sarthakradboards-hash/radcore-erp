import { defineConfig } from 'vitest/config';

// One project per workspace plus the repo-level checks in tools/. Fixtures are data, never test files.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', { test: { name: 'tools', include: ['tools/*.test.ts'] } }],
  },
});
