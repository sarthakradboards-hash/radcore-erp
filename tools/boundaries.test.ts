// Every ADR-001/002 rule must fail its fixtures (ADR-001 "Proof"). A rule that stops working fails this test.
// A fixture folder mirrors the repo: tools/boundary-fixtures/<rule>-<clause>/packages/lib-sales/src/... is judged as
// if it were packages/lib-sales/src/... . The `ok-*` folders are the controls: code the rules must let through.
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const FIXTURES = 'tools/boundary-fixtures';
// Type-aware linting builds a TypeScript program on first use; a cold CI runner can take a while.
const LINT_TIMEOUT = 180_000;
// T1 is proved with M1-08 (ADR-001 Enforcement).
const RULES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9a', 'L9b'];
const CONTROLS = { depcruise: 'ok-allowed-imports', eslint: 'ok-lint-zones' };

// The dependency-cruiser fixtures, each with the one rule it must fail. Every other fixture runs through ESLint.
const DEPCRUISE_RULE: Record<string, string> = {
  'D1-cycle': 'D1-no-circular',
  'D2-hr-imports-sales': 'D2-not-in-allowed',
  'D2-integrations-imports-db': 'D2-not-in-allowed',
  'D2-undeclared-dependency': 'D2-undeclared-dependency',
  'D2-test-helpers-in-production': 'D2-not-in-allowed',
  'D3-library-internal': 'D3-no-deep-import',
  'D3-platform-internal': 'D3-no-deep-import',
  'D3-db-internal': 'D3-no-deep-import',
  'D3-package-specifier': 'D3-unresolvable',
  'D3-outside-workspaces': 'D3-outside-workspaces',
  'D4-db': 'D4-web-server-code',
  'D4-platform-index': 'D4-web-server-code',
  'D4-platform-runtime': 'D4-web-server-code',
  'D4-library-index': 'D4-web-server-code',
  'D4-node-builtin': 'D4-web-node-builtin',
  'D4-node-builtin-route-handler': 'D4-web-node-builtin',
  'D4-node-builtin-via-lib-common': 'D4-web-node-builtin',
  'D5-db': 'D5-contract-server-code',
  'D5-platform-index': 'D5-contract-server-code',
  'D5-platform-runtime': 'D5-contract-server-code',
  'D5-services': 'D5-contract-server-code',
  'D5-transitive': 'D5-contract-server-code',
  'D5-other-library-index': 'D5-contract-server-code',
  'D5-node-builtin': 'D5-contract-node-builtin',
  'D6-db': 'D6-rules-pure',
  'D6-platform': 'D6-rules-pure',
  'D6-services': 'D6-rules-pure',
  'D7-other-module': 'D7-other-module-tables',
  'D7-type-only': 'D7-other-module-tables',
  'D7-platform': 'D7-platform-entries',
  'D7-schema': 'D7-platform-entries',
  'D7-request-context': 'D7-platform-entries',
  'D7-migrate': 'D7-platform-entries',
  'D7-tables-from-web': 'D7-tables-only-from-libraries',
  'D8-api': 'D8-apps-no-db',
  'D8-worker': 'D8-apps-no-db',
  'D9-express': 'D9-no-http-in-packages',
  'D9-next': 'D9-no-http-in-packages',
  'D9-apps': 'D9-no-http-in-packages',
  'L7-library': 'L7-runtime-only-in-apps',
  'E3-node-builtin-lib-common': 'E3-node-builtin',
  'E3-node-builtin-rules': 'E3-node-builtin',
  'E3-node-builtin-via-helper': 'E3-node-builtin',
};
// The ESLint rule ids that count as each tag firing.
const ESLINT_IDS: Record<string, string[]> = {
  D7: ['radcore/d7-no-db-reexport'],
  E1: ['radcore/e1-route-files'],
  E2: ['max-lines'],
  E3: ['radcore/e3-no-io'],
  E4: ['radcore/e4-no-escape'],
  E5: ['@typescript-eslint/ban-ts-comment'],
  E6: ['radcore/e6-no-float-money'],
  L1: ['radcore/no-sql'],
  L2: ['radcore/no-query-strings'],
  L3: ['radcore/no-raw-execution'],
  L4: ['radcore/no-driver'],
  L6: ['radcore/no-raw-html'],
  L8: ['radcore/outbound-only'],
  L9a: ['radcore/tables-in-schema'],
  L9b: ['radcore/views-in-views'],
};
// Clauses that must fire one exact rule other than their tag's.
const CLAUSE_IDS: Record<string, string[]> = {
  'E4-explicit-any': ['@typescript-eslint/no-explicit-any'],
  'E4-unsafe-member-access': ['@typescript-eslint/no-unsafe-member-access'],
  'E4-unsafe-call': ['@typescript-eslint/no-unsafe-call'],
  'E4-unsafe-assignment': ['@typescript-eslint/no-unsafe-assignment'],
  'E4-unsafe-return': ['@typescript-eslint/no-unsafe-return'],
  'E4-unsafe-argument': ['@typescript-eslint/no-unsafe-argument'],
  'E4-declare-global': ['radcore/no-declare'],
  'L4-subpath-import': ['radcore/no-subpath-imports'],
  ...Object.fromEntries(['wrapper', 'alias', 'object', 'cast', 'async', 'callback', 'foreign-generic', 'maybe'].map((k) => [`D7-${k}-export`, ['radcore/d7-no-table-exports']])),
  'L5-update': ['drizzle/enforce-update-with-where'],
  'L5-delete': ['drizzle/enforce-delete-with-where'],
  'L6-no-danger': ['react/no-danger'],
  'L8-eval': ['no-eval'],
  'L8-new-function': ['no-new-func'],
  'L8-implied-eval': ['no-implied-eval'],
};

const dirs = readdirSync(FIXTURES).filter((d) => statSync(join(FIXTURES, d)).isDirectory());
// ADR-003's `C*` fixtures are dependency data, not source; tools/deps.test.ts runs them.
const fixtures = dirs.filter((d) => !d.startsWith('ok-') && !/^C\d+-/.test(d));
const tagOf = (dir: string) => dir.split('-')[0] ?? '';
const eslintFixtures = fixtures.filter((d) => !(d in DEPCRUISE_RULE));

// Lint a fixture folder with the repo's config, from inside the folder, so the config's globs see mirrored paths.
const lint = (dir: string) =>
  new ESLint({ cwd: resolve(FIXTURES, dir), overrideConfigFile: resolve('eslint.config.mjs') }).lintFiles(['.']);

// The fixture prefix is on only for this test (.dependency-cruiser.cjs).
process.env['RADCORE_BOUNDARY_FIXTURES'] = '1';
const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
const violations = async (dir: string) => {
  const { forbidden, allowed, allowedSeverity } = config;
  const { output } = await cruise([`${FIXTURES}/${dir}`],
    { ...config.options, ruleSet: { forbidden, allowed, allowedSeverity }, validate: true });
  if (typeof output === 'string') throw new Error('expected a cruise result');
  // The allowed-table rule (D2) reports under dependency-cruiser's own name.
  return output.summary.violations.map((v) => (v.rule.name === 'not-in-allowed' ? 'D2-not-in-allowed' : v.rule.name));
};

describe('boundary fixtures', () => {
  it.each(RULES)('%s has at least one fixture', (rule) => {
    expect(fixtures.some((d) => tagOf(d) === rule)).toBe(true);
  });

  it('has only known rules and controls', () => {
    expect(fixtures.filter((d) => !RULES.includes(tagOf(d)))).toEqual([]);
    expect(dirs.filter((d) => d.startsWith('ok-')).sort()).toEqual(Object.values(CONTROLS).sort());
    expect(Object.keys(DEPCRUISE_RULE).filter((d) => !fixtures.includes(d))).toEqual([]);
    // An import-graph fixture with no named rule would silently run through ESLint.
    expect(eslintFixtures.filter((d) => /^(D\d|L7)$/.test(tagOf(d)) && !d.startsWith('D7-reexport') && !(d in CLAUSE_IDS))).toEqual([]);
  });

  it('allows the imports ADR-001 §4 permits', async () => {
    expect(await violations(CONTROLS.depcruise)).toEqual([]);
  });

  it('lets each zone file do what its zone allows', async () => {
    const errors = (await lint(CONTROLS.eslint)).flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}: ${m.ruleId} ${m.message}`));
    expect(errors).toEqual([]);
  }, LINT_TIMEOUT);

  it.each(eslintFixtures)('%s fails ESLint', async (d) => {
    const ids = CLAUSE_IDS[d] ?? ESLINT_IDS[tagOf(d)] ?? [];
    const results = await lint(d);
    // Some file in the folder must fire the rule; the others may be helpers it imports.
    const got = results.flatMap((r) => r.messages.map((m) => `${r.filePath}: ${m.ruleId}: ${m.message}`));
    expect(results.flatMap((r) => r.messages).filter((m) => ids.includes(m.ruleId ?? '')), got.join('\n'))
      .not.toHaveLength(0);
  }, LINT_TIMEOUT);

  it.each(Object.entries(DEPCRUISE_RULE))('%s fails dependency-cruiser rule %s', async (d, rule) => {
    const names = await violations(d);
    expect(names, `${d} should fail ${rule}`).toContain(rule);
  });
});
