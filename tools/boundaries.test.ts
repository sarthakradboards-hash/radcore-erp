// Every ADR-001/002 rule must fail its fixtures (ADR-001 "Proof"). A rule that stops working fails this test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const FIXTURES = 'tools/boundary-fixtures';
// T1 is proved with M1-08 (RAD-13 notes, 6 Nov).
const RULES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'E1', 'E2', 'E3', 'E4',
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];
const DEPCRUISE = /^(D\d|L7)$/;
// ESLint rule ids that count as each tag firing, besides our own `adr/<tag>...` ids.
const ESLINT_IDS: Record<string, string[]> = {
  E2: ['max-lines'],
  E4: ['@typescript-eslint/no-explicit-any'],
  L5: ['drizzle/enforce-update-with-where', 'drizzle/enforce-delete-with-where'],
  L6: ['react/no-danger'],
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const posix = (p: string) => p.split(sep).join('/');
// `ok-*` folders are the control: imports the rules must allow.
const fixtures = readdirSync(FIXTURES).filter((d) => statSync(join(FIXTURES, d)).isDirectory() && !d.startsWith('ok-'));
const tagOf = (dir: string) => dir.split('-')[0] ?? '';

describe('boundary fixtures', () => {
  it.each(RULES)('%s has at least one fixture', (rule) => {
    expect(fixtures.some((d) => tagOf(d) === rule)).toBe(true);
  });

  it.each(fixtures.filter((d) => !RULES.includes(tagOf(d))))('%s is named after a known rule', (d) => {
    expect.fail(`${d} does not start with one of ${RULES.join(', ')}`);
  });

  const eslint = new ESLint();
  it.each(fixtures.filter((d) => !DEPCRUISE.test(tagOf(d))))('%s fails ESLint', async (d) => {
    const tag = tagOf(d);
    const ids = ESLINT_IDS[tag] ?? [];
    for (const file of walk(join(FIXTURES, d))) {
      // Lint the fixture as if it sat at its mirrored path in the repo, so the real config's globs apply.
      const filePath = posix(relative(join(FIXTURES, d), file));
      const [result] = await eslint.lintText(readFileSync(file, 'utf8'), { filePath });
      const fired = result?.messages.filter((m) => m.ruleId?.startsWith(`adr/${tag}`) || ids.includes(m.ruleId ?? ''));
      expect(fired, `${d}/${filePath} should fail ${tag}`).not.toHaveLength(0);
    }
  });

  const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
  const violations = async (dir: string) => {
    const { forbidden, allowed, allowedSeverity } = config;
    const { output } = await cruise([dir], { ...config.options, ruleSet: { forbidden, allowed, allowedSeverity }, validate: true });
    if (typeof output === 'string') throw new Error('expected a cruise result');
    // The allowed-table rule (D2) reports under dependency-cruiser's own name.
    return output.summary.violations.map((v) => (v.rule.name === 'not-in-allowed' ? 'D2-not-in-allowed' : v.rule.name));
  };

  it('allows the imports ADR-001 §4 permits', async () => {
    expect(await violations(`${FIXTURES}/ok-allowed-imports`)).toEqual([]);
  });

  it.each(fixtures.filter((d) => DEPCRUISE.test(tagOf(d))))('%s fails dependency-cruiser', async (d) => {
    const tag = tagOf(d);
    const names = await violations(posix(join(FIXTURES, d)));
    expect(names.filter((n) => n.startsWith(`${tag}-`)), `${d} should fail ${tag}; got ${names.join(', ')}`)
      .not.toHaveLength(0);
  });
});
