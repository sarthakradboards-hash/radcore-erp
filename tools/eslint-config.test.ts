// ADR-002 "The config is tested": on sample files, which local rules are on at error, with their full selector and
// pattern sets, and the exact zone of each rule. The expected options are literals in tools/eslint-options.json, not
// read back from the config, so dropping a selector, widening a zone or a later block overriding a rule fails here.
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { L1_EXTRA_NAMES, L1_SQL_ZONE, REQUEST_CONTEXT_HELPER, ZONES } from '../eslint.config.mjs';

const VIEW = 'packages/db/views/!(index|*.test|*.d).ts';
const PINNED = JSON.parse(readFileSync('tools/eslint-options.json', 'utf8')) as Record<string, { allowNames?: string[] }>;

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
  expect(REQUEST_CONTEXT_HELPER).toBe('applyRequestContext');
});

const ALLOW = PINNED['radcore/no-sql']?.allowNames ?? [];
const L1 = { base: { allowNames: ALLOW }, zone: { allowNames: [...ALLOW, 'sql'], zone: true } };
const EVERYWHERE = ['radcore/no-driver', 'radcore/no-raw-html', 'radcore/e6-no-float-money', 'radcore/tables-in-schema',
  'radcore/views-in-views',
  'radcore/no-subpath-imports', 'radcore/no-declare'];
const SERVER = ['radcore/no-query-strings', 'radcore/no-raw-execution', 'radcore/outbound-only', ...EVERYWHERE];
const LIB = [...SERVER, 'radcore/e4-no-escape', 'radcore/d7-no-db-reexport'];
const TYPED_E4 = ['no-unsafe-member-access', 'no-unsafe-call', 'no-unsafe-assignment', 'no-unsafe-return', 'no-unsafe-argument']
  .map((r) => `@typescript-eslint/${r}`);
const without = (list: string[], ...drop: string[]) => list.filter((r) => !drop.includes(r));

// For each sample: the radcore rules on (beyond L1), L1's options, and whether E4's typed rules apply.
const SAMPLES: Record<string, { rules: string[]; l1: object; typed: boolean; server: boolean }> = {
  'packages/db/src/sales/repo.ts': { rules: [...SERVER, 'radcore/e4-no-escape'], l1: L1.base, typed: true, server: true },
  'packages/lib-sales/src/services/invoices.ts': { rules: LIB, l1: L1.base, typed: true, server: true },
  'apps/api/src/routes/sales.ts': { rules: [...SERVER, 'radcore/e1-route-files'], l1: L1.base, typed: false, server: true },
  'packages/db/views/index.ts': { rules: SERVER, l1: L1.base, typed: false, server: true },
  'packages/db/views/receivables-ageing.ts': {
    rules: without(SERVER, 'radcore/no-query-strings', 'radcore/views-in-views'), l1: L1.zone, typed: false, server: true },
  'packages/db/src/request-context.ts': {
    rules: without(SERVER, 'radcore/no-query-strings', 'radcore/no-raw-execution'),
    l1: { ...L1.zone, helper: 'applyRequestContext' }, typed: false, server: true },
  'packages/lib-sales/src/services/invoices.test.ts': {
    rules: LIB, l1: { ...L1.base, importExpressions: false }, typed: true, server: true },
  // Beyond ADR-002's seven: a view's test file is outside the zone, and so is a web page.
  'packages/db/views/receivables-ageing.test.ts': { rules: SERVER, l1: { ...L1.base, importExpressions: false }, typed: false, server: true },
  'packages/db/src/sales/tables.ts': { rules: without(SERVER, 'radcore/tables-in-schema'), l1: L1.zone, typed: false, server: true },
  'packages/db/src/sales/relations.ts': {
    rules: [...SERVER, 'radcore/e4-no-escape'], l1: { allowNames: [...ALLOW, 'relations'] }, typed: true, server: true },
  'apps/web/app/page.tsx': { rules: EVERYWHERE, l1: L1.base, typed: false, server: false },
  // E3's three scopes, and D7's export guard on library entries.
  'packages/lib-common/src/money.ts': { rules: [...LIB, 'radcore/e3-no-io'], l1: L1.base, typed: true, server: true },
  'packages/lib-sales/src/contract.ts': {
    rules: [...LIB, 'radcore/e3-no-io', 'radcore/d7-no-table-exports'], l1: L1.base, typed: true, server: true },
  'packages/lib-sales/src/rules/tax.ts': { rules: [...LIB, 'radcore/e3-no-io'], l1: L1.base, typed: true, server: true },
  'packages/lib-sales/src/index.ts': { rules: [...LIB, 'radcore/d7-no-table-exports'], l1: L1.base, typed: true, server: true },
};

describe.each(Object.entries(SAMPLES))('%s', (file, want) => {
  it('has exactly the expected local rules, at error, with their full options', async () => {
    const { rules } = await new ESLint().calculateConfigForFile(file);
    const local = Object.fromEntries(Object.entries(rules).filter(([id]) => id.startsWith('radcore/')));
    const expected = Object.fromEntries([
      ['radcore/no-sql', [2, want.l1]],
      ...want.rules.map((id) => [id, [2, PINNED[id]]]),
    ]);
    expect(local).toEqual(expected);
  });

  it("has E2, E5, L5, L8's eval bans and (where they apply) E4's typed rules at error", async () => {
    const { rules } = await new ESLint().calculateConfigForFile(file);
    expect(rules['max-lines']).toEqual([2, { max: 400, skipBlankLines: false, skipComments: false }]);
    expect(rules['@typescript-eslint/ban-ts-comment'])
      .toEqual([2, { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': true }]);
    for (const id of TYPED_E4) expect(rules[id]?.[0] ?? 0, id).toBe(want.typed ? 2 : 0);
    for (const id of ['no-eval', 'no-new-func', 'no-implied-eval', 'drizzle/enforce-update-with-where',
      'drizzle/enforce-delete-with-where']) expect(rules[id]?.[0] ?? 0, id).toBe(want.server ? 2 : 0);
  });
});
