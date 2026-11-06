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
// T1 is proved with M1-08 (ADR-001 Enforcement).
const RULES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'E1', 'E2', 'E3', 'E4', 'E5',
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9a', 'L9b'];
const DEPCRUISE = /^(D\d|L7)$/;
// The ESLint rule ids that count as each tag firing.
const ESLINT_IDS: Record<string, string[]> = {
  E1: ['radcore/e1-route-files'],
  E2: ['max-lines'],
  E3: ['radcore/e3-no-io'],
  E4: ['@typescript-eslint/no-explicit-any', '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-call',
    '@typescript-eslint/no-unsafe-assignment', 'radcore/e4-no-escape'],
  E5: ['@typescript-eslint/ban-ts-comment'],
  L1: ['radcore/no-sql'],
  L2: ['radcore/no-query-strings'],
  L3: ['radcore/no-raw-execution'],
  L4: ['radcore/no-driver'],
  L5: ['drizzle/enforce-update-with-where', 'drizzle/enforce-delete-with-where'],
  L6: ['radcore/no-raw-html', 'react/no-danger'],
  L8: ['radcore/outbound-only'],
  L9a: ['radcore/tables-in-schema'],
  L9b: ['radcore/views-in-views'],
};

// Clauses that must fire one exact rule, where the tag's other rules could also fire on the same code.
const CLAUSE_IDS: Record<string, string[]> = {
  'E4-explicit-any': ['@typescript-eslint/no-explicit-any'],
  'E4-unsafe-member-access': ['@typescript-eslint/no-unsafe-member-access'],
  'E4-unsafe-call': ['@typescript-eslint/no-unsafe-call'],
  'E4-unsafe-assignment': ['@typescript-eslint/no-unsafe-assignment'],
  'L5-update': ['drizzle/enforce-update-with-where'],
  'L5-delete': ['drizzle/enforce-delete-with-where'],
  'L6-no-danger': ['react/no-danger'],
};

const dirs = readdirSync(FIXTURES).filter((d) => statSync(join(FIXTURES, d)).isDirectory());
const fixtures = dirs.filter((d) => !d.startsWith('ok-'));
const tagOf = (dir: string) => dir.split('-')[0] ?? '';

// Lint a fixture folder with the repo's config, from inside the folder, so the config's globs see mirrored paths.
const lint = (dir: string) =>
  new ESLint({ cwd: resolve(FIXTURES, dir), overrideConfigFile: resolve('eslint.config.mjs') }).lintFiles(['.']);

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

  it.each(fixtures.filter((d) => !RULES.includes(tagOf(d))))('%s is named after a known rule', (d) => {
    expect.fail(`${d} does not start with one of ${RULES.join(', ')}`);
  });

  it('allows the imports ADR-001 §4 permits', async () => {
    expect(await violations('ok-allowed-imports')).toEqual([]);
  });

  it('lets each zone file do what its zone allows', async () => {
    const errors = (await lint('ok-lint-zones')).flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}: ${m.ruleId} ${m.message}`));
    expect(errors).toEqual([]);
  }, 60_000);

  it.each(fixtures.filter((d) => !DEPCRUISE.test(tagOf(d))))('%s fails ESLint', async (d) => {
    const ids = CLAUSE_IDS[d] ?? ESLINT_IDS[tagOf(d)] ?? [];
    const results = await lint(d);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const got = r.messages.map((m) => `${m.ruleId}: ${m.message}`);
      expect(r.messages.filter((m) => ids.includes(m.ruleId ?? '')), `${r.filePath}\n${got.join('\n')}`).not.toHaveLength(0);
    }
  }, 60_000);

  it.each(fixtures.filter((d) => DEPCRUISE.test(tagOf(d))))('%s fails dependency-cruiser', async (d) => {
    const tag = tagOf(d);
    const names = await violations(d);
    expect(names.filter((n) => n.startsWith(`${tag}-`)), `${d} should fail ${tag}; got ${names.join(', ')}`)
      .not.toHaveLength(0);
  });
});
