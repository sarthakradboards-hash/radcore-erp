// ADR-002: widening the SQL zone means amending the ADR, so the constant is pinned here.
import { expect, it } from 'vitest';
import { SQL_ZONE } from '../eslint.config.mjs';

it('SQL_ZONE is exactly the ADR-002 list', () => {
  expect(SQL_ZONE).toEqual([
    'packages/db/migrations/**',
    'packages/db/views/*.ts',
    'packages/db/src/*/tables.ts',
    'packages/db/src/columns.ts',
    'packages/db/src/request-context.ts',
  ]);
});
