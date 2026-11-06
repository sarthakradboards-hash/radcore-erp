// ADR-002 "The config is tested": on sample files, which local rules are on at error, with their full options, and
// the exact zone of each rule. Widening a zone or dropping a selector fails here.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { L1_EXTRA_NAMES, L1_SQL_ZONE, OPTIONS, ZONES } from '../eslint.config.mjs';

const VIEW = 'packages/db/views/!(index).ts';

it('each zone is exactly the ADR-002 table', () => {
  expect(ZONES).toEqual({
    'radcore/no-query-strings': [VIEW, 'packages/db/src/request-context.ts'],
    'radcore/no-raw-execution': ['packages/db/src/request-context.ts'],
    'radcore/no-driver': ['packages/lib-platform/src/db/client.ts', 'packages/db/src/migrate.ts'],
    'radcore/tables-in-schema': ['packages/db/src/*/tables.ts', 'packages/db/src/columns.ts'],
    'radcore/views-in-views': [VIEW],
    'radcore/outbound-only': ['packages/lib-platform/src/http/outbound.ts'],
  });
  expect(L1_SQL_ZONE).toEqual([VIEW, 'packages/db/src/*/tables.ts', 'packages/db/src/columns.ts',
    'packages/db/src/request-context.ts']);
  expect(L1_EXTRA_NAMES).toEqual({
    'packages/db/src/*/relations.ts': ['relations'],
    'packages/db/src/conditions.ts': ['notInArray'],
    'packages/db/src/module-tx.ts': ['getOperators', 'getOrderByOperators', 'is', 'getTableName'],
  });
});

const L1 = OPTIONS['radcore/no-sql'];
const EVERYWHERE = ['radcore/no-driver', 'radcore/no-raw-html', 'radcore/tables-in-schema', 'radcore/views-in-views'];
const SERVER = ['radcore/no-query-strings', 'radcore/no-raw-execution', 'radcore/outbound-only', ...EVERYWHERE];
const TYPED_E4 = ['@typescript-eslint/no-explicit-any', '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call', '@typescript-eslint/no-unsafe-assignment'];
const without = (list: string[], ...drop: string[]) => list.filter((r) => !drop.includes(r));

// For each sample: the radcore rules on (beyond L1), L1's options, and whether E4's typed rules apply.
const SAMPLES: Record<string, { rules: string[]; l1: object; typed: boolean }> = {
  'packages/db/src/sales/repo.ts': { rules: [...SERVER, 'radcore/e4-no-escape'], l1: L1, typed: true },
  'packages/lib-sales/src/services/invoices.ts': { rules: [...SERVER, 'radcore/e4-no-escape'], l1: L1, typed: true },
  'apps/api/src/routes/sales.ts': { rules: [...SERVER, 'radcore/e1-route-files'], l1: L1, typed: false },
  'packages/db/views/index.ts': { rules: SERVER, l1: L1, typed: false },
  'packages/db/views/receivables-ageing.ts': {
    rules: without(SERVER, 'radcore/no-query-strings', 'radcore/views-in-views'), l1: { ...L1, zone: true }, typed: false },
  'packages/db/src/request-context.ts': {
    rules: without(SERVER, 'radcore/no-query-strings', 'radcore/no-raw-execution'),
    l1: { ...L1, zone: true, helperBodies: true }, typed: false },
  'packages/lib-sales/src/services/invoices.test.ts': {
    rules: [...SERVER, 'radcore/e4-no-escape'], l1: { ...L1, importExpressions: false }, typed: true },
};

describe.each(Object.entries(SAMPLES))('%s', (file, want) => {
  it('has exactly the expected local rules, at error, with their full options', async () => {
    const { rules } = await new ESLint().calculateConfigForFile(file);
    const local = Object.fromEntries(Object.entries(rules).filter(([id]) => id.startsWith('radcore/')));
    const expected = Object.fromEntries([
      ['radcore/no-sql', [2, want.l1]],
      ...want.rules.map((id) => [id, [2, OPTIONS[id as keyof typeof OPTIONS]]]),
    ]);
    expect(local).toEqual(expected);
  });

  it('has E2, E5 and (where it applies) E4\'s typed rules at error', async () => {
    const { rules } = await new ESLint().calculateConfigForFile(file);
    expect(rules['max-lines']).toEqual([2, { max: 400, skipBlankLines: false, skipComments: false }]);
    expect(rules['@typescript-eslint/ban-ts-comment'])
      .toEqual([2, { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': true }]);
    for (const id of TYPED_E4.slice(1)) expect(rules[id]?.[0] ?? 0).toBe(want.typed ? 2 : 0);
  });
});
