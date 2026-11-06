// RAD-49 (M1-31): tests run the real production paths, on any date, each on its own.
// - RC-155: production code has no test-mode branch, so rate limits, hash cost and webhooks run as in production.
// - RC-156: tests read no run date, never sleep, and never wrap an assertion in a condition.
// - RC-222: tests share no mutable state, and `npm test` runs files and tests in a shuffled order.
// The checks are their own ESLint run with in-memory config, apart from eslint.config.mjs, so they can't replace
// an ADR rule's options there. Each selector has a violating sample below, so a check that stops working fails here.
import { readFileSync } from 'node:fs';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const sel = (message: string) => (selector: string) => ({ selector, message });
const LET = String.raw`VariableDeclaration[kind=/^(let|var)$/]`;
const ENV = String.raw`/^(NODE_ENV|VITEST\w*|JEST_WORKER_ID|TEST)$/`;

const TEST_MODE = [
  `MemberExpression[property.name=${ENV}]`,
  `MemberExpression[property.value=${ENV}]`,
  `MemberExpression[property.quasis.0.value.cooked=${ENV}]`,
  `ObjectPattern > Property[key.name=${ENV}]`,
  "MemberExpression[object.type='MetaProperty'][property.name='vitest']",
  String.raw`Identifier[name=/^(is|in)_?tests?_?(mode|env)?$|^__tests?__$/i]`,
  String.raw`ImportDeclaration[source.value=/^(vitest|@vitest\/|@radcore\/test-helpers)/]`,
].map(sel('[RC-155] Production code takes the same path under test: no test-mode branch or test import (RAD-49)'));

const CLOCK = [
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "CallExpression[callee.name='Date']",
  "CallExpression[callee.object.name=/^(Date|performance)$/][callee.property.name='now']",
].map(sel('[RC-156] A test never reads the run date: use fakeClock from @radcore/test-helpers'));
const SLEEP = [
  "CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate)$/]",
  "CallExpression[callee.property.name=/^(setTimeout|setInterval|setImmediate)$/]",
  String.raw`ImportDeclaration[source.value=/^(node:)?timers(\/promises)?$/]`,
].map(sel('[RC-156] A test never sleeps: wait on the event itself, or move the fake clock'));
const CONDITIONAL = [
  ":matches(IfStatement, ConditionalExpression, LogicalExpression, SwitchStatement, CatchClause) CallExpression[callee.name='expect']",
].map(sel('[RC-156] An assertion always runs: no expect inside if, ?:, &&, ||, ??, switch or catch'));
// shortcut: a module-level `const` array or object mutated by tests isn't caught here; the shuffled order is
// what fails such a test. Add a selector if one turns up.
const SHARED = [
  `Program > ${LET}`,
  `Program > ExportNamedDeclaration > ${LET}`,
  `:matches(CallExpression[callee.name='describe'], CallExpression[callee.object.name='describe'], CallExpression[callee.callee.object.name='describe']) > :function > BlockStatement > ${LET}`,
].map(sel('[RC-222] Tests share no mutable state: build what a test needs inside it, with a factory'));

const TS = ['**/*.ts', '**/*.tsx'];
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];
const block = (ignores: string[], files: string[], syntax: { selector: string; message: string }[]): Linter.Config =>
  ({ files, ignores, languageOptions: { parser: tseslint.parser }, rules: { 'no-restricted-syntax': ['error', ...syntax] } });
// The two blocks never match the same file, so neither replaces the other's options.
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { ignores: ['**/node_modules/**', 'apps/web/.next/**', 'tools/boundary-fixtures/**'] },
  block([...TEST_FILES, 'packages/test-helpers/**'], TS, TEST_MODE),
  block([], TEST_FILES, [...CLOCK, ...SLEEP, ...CONDITIONAL, ...SHARED]),
] });
const problems = (results: ESLint.LintResult[]) =>
  results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`));
const lintSample = async (code: string, filePath: string) => problems(await eslint.lintText(code, { filePath }));

it('finds no test-mode branch in production code and no unsafe pattern in any test', async () => {
  expect(problems(await eslint.lintFiles(['apps', 'packages', 'tools/*.test.ts']))).toEqual([]);
}, 120_000);

it('runs files and tests in a shuffled order under npm test (RC-222)', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  expect(pkg.scripts['test']).toBe('vitest run --sequence.shuffle');
});

const PROD = 'packages/lib-sales/src/services/orders.ts';
const TEST = 'packages/lib-sales/src/services/orders.test.ts';

describe('each check fails its violating samples', () => {
  it.each([
    "if (process.env.NODE_ENV === 'test') skip();",
    "const v = process.env['VITEST_POOL_ID'];",
    'const v = process.env[`JEST_WORKER_ID`];',
    'const { NODE_ENV } = process.env;',
    'if (import.meta.vitest) run();',
    'export const isTest = true;',
    'const IN_TEST_MODE = false;',
    "import { vi } from 'vitest';",
    "import { fakeClock } from '@radcore/test-helpers';",
  ])('production: %s', async (code) => {
    expect((await lintSample(code, PROD)).join('\n')).toContain('[RC-155]');
  });

  it.each([
    ['const d = new Date();', 'RC-156'],
    ['const s = Date();', 'RC-156'],
    ['const t = Date.now();', 'RC-156'],
    ['const t = performance.now();', 'RC-156'],
    ['await new Promise((r) => setTimeout(r, 100));', 'RC-156'],
    ['globalThis.setInterval(tick, 10);', 'RC-156'],
    ["import { setTimeout } from 'node:timers/promises';", 'RC-156'],
    ['if (rows.length) expect(rows[0]).toBe(1);', 'RC-156'],
    ['rows.length ? expect(rows[0]).toBe(1) : null;', 'RC-156'],
    ['ok && expect(a).toBe(1);', 'RC-156'],
    ['switch (k) { case 1: expect(a).toBe(1); }', 'RC-156'],
    ['try { run(); } catch (e) { expect(e).toBeTruthy(); }', 'RC-156'],
    ['let id: string;', 'RC-222'],
    ['export let id = 1;', 'RC-222'],
    ["describe('x', () => { let id = ''; it('a', () => { id = 'y'; }); });", 'RC-222'],
    ["describe.each([1])('x %s', () => { var n = 0; });", 'RC-222'],
  ])('test: %s', async (code, tag) => {
    expect((await lintSample(code, TEST)).join('\n')).toContain(`[${tag}]`);
  });
});

describe('each check lets the safe forms through', () => {
  it('production code reading its settings and naming tests in comments', async () => {
    const code = '// NODE_ENV is never read here.\nexport const cost = (s: { memoryKib: number }) => s.memoryKib;\n'
      + 'export const contest = 1; export const latest = 2;';
    expect(await lintSample(code, PROD)).toEqual([]);
  });

  it('a test with a fixed date, a loop of assertions and state kept inside one test', async () => {
    const code = [
      "import { expect, it } from 'vitest';",
      "const d = new Date('2026-11-07T00:00:00Z');",
      'for (const x of [1, 2]) expect(x).toBeGreaterThan(0);',
      "it('a', () => { let n = 1; n += 1; expect(n ?? 0).toBe(2); expect(() => d.toISOString()).not.toThrow(); });",
    ].join('\n');
    expect(await lintSample(code, TEST)).toEqual([]);
  });

  it('the test helpers themselves, which tests may import', async () => {
    expect(await lintSample("import { factory } from '@radcore/test-helpers';\nexport { factory };", TEST)).toEqual([]);
  });
});
