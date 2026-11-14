// RAD-49 (M1-31): tests run the real production paths, on any date, each on its own.
// - RC-155: production code has no test-mode branch, so rate limits, hash cost and webhooks run as in production.
// - RC-156: tests read no run date, never sleep, and never wrap an assertion in a condition.
// - RC-222: tests share no mutable state, and `npm test` runs files and tests in a shuffled order.
// The checks are their own ESLint run with in-memory config, apart from eslint.config.mjs, so they can't replace
// an ADR rule's options there. Each selector has a violating sample below, so a check that stops working fails here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint, type Linter, type Rule } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const sel = (message: string) => (selector: string) => ({ selector, message });
const LET = String.raw`VariableDeclaration[kind=/^(let|var)$/]`;
const ENV = String.raw`/^(NODE_ENV|VITEST\w*|JEST_WORKER_ID|TEST)$/`;

// The one allowed read (coordinator, for PR #20's dev-server CSP): `process.env.NODE_ENV === 'development'`, written
// that way round. Under vitest NODE_ENV is 'test', so it still takes the production path. `!== 'production'` is
// true under test, so it stays refused, as does every other read.
const DEV_ONLY = "BinaryExpression[operator='==='][right.value='development'] > "
  + "MemberExpression.left[object.object.name='process'][object.property.name='env'][property.name='NODE_ENV']";
const TEST_MODE = [
  `MemberExpression[property.name=${ENV}]:not(${DEV_ONLY})`,
  `MemberExpression[property.value=${ENV}]`,
  `MemberExpression[property.quasis.0.value.cooked=${ENV}]`,
  `ObjectPattern > Property[key.name=${ENV}]`,
  "MemberExpression[object.type='MetaProperty'][property.name='vitest']",
  String.raw`Identifier[name=/^(is|in)_?tests?_?(mode|env)?$|^__tests?__$/i]`,
  String.raw`ImportDeclaration[source.value=/^(vitest|@vitest\/|@radcore\/test-helpers)/]`,
].map(sel('[RC-155] Production code takes the same path under test: no test-mode branch or test import (RAD-49)'));

const CLOCK = [
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "NewExpression[callee.property.name='Date'][arguments.length=0]",
  "CallExpression[callee.name='Date']",
  "CallExpression[callee.property.name='Date']",
  "CallExpression[callee.object.name=/^(Date|performance)$/][callee.property.name='now']",
  "CallExpression[callee.object.property.name=/^(Date|performance)$/][callee.property.name='now']",
  "MemberExpression:matches([object.name='Temporal'], [object.property.name='Temporal'])[property.name='Now']",
  // `new Intl.DateTimeFormat(...).format()` with no argument formats now.
  "CallExpression[arguments.length=0][callee.property.name=/^format(ToParts)?$/][callee.object.callee.property.name='DateTimeFormat']",
].map(sel('[RC-156] A test never reads the run date: use fakeClock from @radcore/test-helpers'));
const SLEEP = [
  "CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate)$/]",
  "CallExpression[callee.property.name=/^(setTimeout|setInterval|setImmediate)$/]",
  String.raw`ImportDeclaration[source.value=/^(node:)?timers(\/promises)?$/]`,
].map(sel('[RC-156] A test never sleeps: wait on the event itself, or move the fake clock'));
const ASSERT = 'CallExpression:matches([callee.name=/^(expect|assert)$/], [callee.object.name=/^(expect|assert)$/])';
const CONDITIONAL = [
  `:matches(IfStatement, ConditionalExpression, LogicalExpression, SwitchStatement, CatchClause) ${ASSERT}`,
].map(sel('[RC-156] An assertion always runs: no expect or assert inside if, ?:, &&, ||, ??, switch or catch'));

// The name a call starts from: `it`, `it.each(t)`, `test.skipIf(x)` and `it.only` all start from it or test.
type Callee = { type: string; name?: string; object?: Callee; callee?: Callee };
const rootName = (n: Callee | undefined): string | undefined => {
  if (n?.type === 'Identifier') return n.name;
  return n?.type === 'MemberExpression' || n?.type === 'CallExpression' ? rootName(n.object ?? n.callee) : undefined;
};
// A test is a call to it or test, or to a name made from one with `.extend(...)` at the top of the file (RAD-59):
// `const dbTest = test.extend({ ... })` defines tests too, so the checks below must see them.
type Declared = { type: string; declarations?: { id: { type: string; name?: string }; init?: Callee | null }[];
  declaration?: Declared | null };
function testNames(program: { body: Declared[] }): Set<string> {
  const names = new Set(['it', 'test']);
  for (const s of program.body) {
    const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
    for (const d of decl?.type === 'VariableDeclaration' ? decl.declarations ?? [] : []) {
      const init = d.init;
      const extended = init?.type === 'CallExpression' && init.callee?.type === 'MemberExpression'
        && (init.callee as { property?: { name?: string } }).property?.name === 'extend';
      if (extended && d.id.type === 'Identifier' && d.id.name && names.has(rootName(init.callee) ?? '')) names.add(d.id.name);
    }
  }
  return names;
}
// An early `return` under a condition skips the assertions after it: `if (!rows.length) return;`. Selectors can't
// say "the nearest function is the test's own callback", so this one check is a small rule.
const earlyReturn: Rule.RuleModule = {
  meta: { type: 'problem', schema: [],
    messages: { m: '[RC-156] An assertion always runs: no return inside if, switch or catch in a test' } },
  create: (context) => ({
    ReturnStatement(node) {
      const tests = testNames(context.sourceCode.ast as unknown as { body: Declared[] });
      let conditional = false;
      for (const a of [...context.sourceCode.getAncestors(node)].reverse()) {
        if (a.type === 'IfStatement' || a.type === 'SwitchStatement' || a.type === 'CatchClause') conditional = true;
        if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration') {
          const parent: Callee | null = (a as Rule.Node).parent;
          const isTest = parent?.type === 'CallExpression' && parent.callee !== a && tests.has(rootName(parent.callee) ?? '');
          if (conditional && isTest) context.report({ node, messageId: 'm' });
          return;
        }
      }
    },
  }),
};
// A `continue`, or a `break` out of the loop, under a condition skips the assertions in a loop of them (RAD-59):
// `for (const r of rows) { if (!r.ok) continue; expect(r.total).toBe(1); }` can assert nothing.
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
const ASSERTS_IN = /\b(expect|assert)\s*[.(]/;
const skippedLoop: Rule.RuleModule = {
  meta: { type: 'problem', schema: [],
    messages: { m: '[RC-156] An assertion always runs: no continue or break under a condition in a loop of assertions' } },
  create: (context) => {
    const check = (node: Rule.Node & { label?: { name: string } | null | undefined }, isBreak: boolean) => {
      let conditional = false;
      for (const a of [...context.sourceCode.getAncestors(node)].reverse()) {
        if (FUNCTIONS.has(a.type)) return;
        // An unlabelled break inside a switch ends the switch, not the loop.
        if (isBreak && !node.label && a.type === 'SwitchStatement') return;
        if (a.type === 'IfStatement' || a.type === 'SwitchStatement' || a.type === 'CatchClause') conditional = true;
        if (!LOOPS.has(a.type)) continue;
        const parent = (a as Rule.Node).parent as { type: string; label?: { name: string } } | null;
        if (node.label && !(parent?.type === 'LabeledStatement' && parent.label?.name === node.label.name)) continue;
        if (conditional && ASSERTS_IN.test(context.sourceCode.getText(a))) context.report({ node, messageId: 'm' });
        return;
      }
    };
    return { ContinueStatement: (node) => check(node, false), BreakStatement: (node) => check(node, true) };
  },
};
// A test that skips itself while it runs (`ctx.skip()`, or a destructured `skip()`) asserts nothing and still shows
// as run on the condition it hid (RAD-59). it.skip(name, fn) and skipIf, decided before the test, stay allowed.
const SKIP = [
  "CallExpression[callee.property.name='skip']:not([arguments.1.type=/FunctionExpression$/])",
  "CallExpression[callee.name='skip']",
].map(sel('[RC-156] An assertion always runs: no skip() inside a test; decide it before, with it.skipIf'));
// shortcut: a module-level `const` array or object mutated by tests isn't caught here; the shuffled order is
// what fails such a test. Add a selector if one turns up.
const SHARED = [
  `Program > ${LET}`,
  `Program > ExportNamedDeclaration > ${LET}`,
  `CallExpression:matches([callee.name=/^(describe|suite)$/], [callee.object.name=/^(describe|suite)$/], [callee.callee.object.name=/^(describe|suite)$/]) > :function > BlockStatement > ${LET}`,
].map(sel('[RC-222] Tests share no mutable state: build what a test needs inside it, with a factory'));
// The outbox is shared by every test file running at once, so a test's relay pass names the jobs it takes: a pass
// over all of it would try, and count against, other files' rows (RAD-79).
const RELAY = [
  "CallExpression[callee.name='relayOutbox']:not(:has(Property[key.name='only']))",
].map(sel('[RC-222] A test relays only its own jobs: pass relayOutbox its `only` job names (RAD-79)'));

const TS = ['**/*.ts', '**/*.tsx'];
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];
const block = (ignores: string[], files: string[], syntax: { selector: string; message: string }[]): Linter.Config =>
  ({ files, ignores, languageOptions: { parser: tseslint.parser }, rules: { 'no-restricted-syntax': ['error', ...syntax] } });
// The two blocks never match the same file, so neither replaces the other's options. No comment can switch a
// check off (noInlineConfig), as in eslint.config.mjs.
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { ignores: ['**/node_modules/**', 'apps/web/.next/**', 'tools/boundary-fixtures/**'] },
  { linterOptions: { noInlineConfig: true } },
  block([...TEST_FILES, 'packages/test-helpers/**'], TS, TEST_MODE),
  block([], TEST_FILES, [...CLOCK, ...SLEEP, ...CONDITIONAL, ...SHARED, ...RELAY, ...SKIP]),
  { files: TEST_FILES, plugins: { hygiene: { rules: { 'early-return': earlyReturn, 'skipped-loop': skippedLoop } } },
    rules: { 'hygiene/early-return': 'error', 'hygiene/skipped-loop': 'error' } },
] });
const problems = (results: ESLint.LintResult[]) =>
  results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`));
const lintSample = async (code: string, filePath: string) => problems(await eslint.lintText(code, { filePath }));

it('finds no test-mode branch in production code and no unsafe pattern in any test', async () => {
  expect(problems(await eslint.lintFiles(['apps', 'packages', 'tools/*.test.ts']))).toEqual([]);
}, 120_000);

// The root config's sequence.shuffle doesn't reach the packages/* folder projects, so every run carries the flag.
it('runs files and tests in a shuffled order in npm test and in every CI vitest step (RC-222)', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  expect(pkg.scripts['test']).toBe('vitest run --sequence.shuffle');
  const runs = readdirSync('.github/workflows').flatMap((f) => readFileSync(join('.github/workflows', f), 'utf8')
    .split('\n').filter((l) => /\bvitest\b/.test(l)).map((l) => `${f}: ${l.trim()}`));
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.filter((l) => !/\bvitest run\b.*--sequence\.shuffle\b/.test(l))).toEqual([]);
});

const PROD = 'packages/lib-sales/src/services/orders.ts';
const TEST = 'packages/lib-sales/src/services/orders.test.ts';

describe('each check fails its violating samples', () => {
  it.each([
    "if (process.env.NODE_ENV === 'test') skip();",
    "if (process.env.NODE_ENV !== 'production') relax();",
    "if (process.env.NODE_ENV == 'development') relax();",
    "if ('development' === process.env.NODE_ENV) relax();",
    "if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') relax();",
    "const dev = process.env['NODE_ENV'] === 'development';",
    "const dev = env.NODE_ENV === 'development';",
    "const v = process.env['VITEST_POOL_ID'];",
    'const v = process.env[`JEST_WORKER_ID`];',
    'const { NODE_ENV } = process.env;',
    'if (import.meta.vitest) run();',
    'export const isTest = true;',
    'const IN_TEST_MODE = false;',
    "import { vi } from 'vitest';",
    "import { fakeClock } from '@radcore/test-helpers';",
    '// eslint-disable-next-line no-restricted-syntax\nconst v = process.env.NODE_ENV;',
    '/* eslint-disable */\nexport const isTest = true;',
  ])('production: %s', async (code) => {
    expect((await lintSample(code, PROD)).join('\n')).toContain('[RC-155]');
  });

  it.each([
    ['const d = new Date();', 'RC-156'],
    ['const s = Date();', 'RC-156'],
    ['const t = Date.now();', 'RC-156'],
    ['const t = performance.now();', 'RC-156'],
    ['const t = globalThis.Date.now();', 'RC-156'],
    ['const d = new globalThis.Date();', 'RC-156'],
    ['const s = globalThis.Date();', 'RC-156'],
    ["const d = Temporal.Now.plainDateISO('Asia/Kolkata');", 'RC-156'],
    ['const i = Temporal.Now.instant();', 'RC-156'],
    ['const i = globalThis.Temporal.Now.instant();', 'RC-156'],
    ["const s = new Intl.DateTimeFormat('en-IN').format();", 'RC-156'],
    ['// eslint-disable-next-line no-restricted-syntax\nconst d = new Date();', 'RC-156'],
    ['/* eslint-disable */\nconst d = new Date();', 'RC-156'],
    ['await new Promise((r) => setTimeout(r, 100));', 'RC-156'],
    ['globalThis.setInterval(tick, 10);', 'RC-156'],
    ["import { setTimeout } from 'node:timers/promises';", 'RC-156'],
    ['if (rows.length) expect(rows[0]).toBe(1);', 'RC-156'],
    ['rows.length ? expect(rows[0]).toBe(1) : null;', 'RC-156'],
    ['ok && expect(a).toBe(1);', 'RC-156'],
    ['switch (k) { case 1: expect(a).toBe(1); }', 'RC-156'],
    ['try { run(); } catch (e) { expect(e).toBeTruthy(); }', 'RC-156'],
    ['if (x) expect.soft(a).toBe(1);', 'RC-156'],
    ['if (x) assert.equal(a, 1);', 'RC-156'],
    ['if (x) assert(a);', 'RC-156'],
    ["it('a', () => { if (!rows.length) return; expect(rows[0]).toBe(1); });", 'RC-156'],
    ["it('a', async function () { switch (k) { case 1: return; } expect(a).toBe(1); });", 'RC-156'],
    ["it('a', () => { try { run(); } catch { return; } expect(a).toBe(1); });", 'RC-156'],
    ["it.each([1])('a %s', (n) => { if (n) { return; } expect(n).toBe(1); });", 'RC-156'],
    ["test.skipIf(false)('a', () => { if (x) return; expect(a).toBe(1); });", 'RC-156'],
    ["suite('x', () => { let id = ''; });", 'RC-222'],
    ['let id: string;', 'RC-222'],
    ['export let id = 1;', 'RC-222'],
    ["describe('x', () => { let id = ''; it('a', () => { id = 'y'; }); });", 'RC-222'],
    ["describe.each([1])('x %s', () => { var n = 0; });", 'RC-222'],
    ['await relayOutbox(db, queue, log);', 'RC-222'],
    ['await relayOutbox(db, queue, log, { batch: 3 });', 'RC-222'],
    // RAD-59: a loop that can skip its assertions, a test that skips itself, and tests made with test.extend.
    ['for (const r of rows) { if (!r.ok) continue; expect(r.total).toBe(1); }', 'RC-156'],
    ['for (const r of rows) { if (r.done) break; expect(r.total).toBe(1); }', 'RC-156'],
    ['while (next()) { switch (k) { case 1: continue; } assert(a); }', 'RC-156'],
    ['outer: for (const a of xs) { for (const b of a) { if (b) continue outer; } expect(a).toBe(1); }', 'RC-156'],
    ["it('a', (ctx) => { if (!db) ctx.skip(); expect(a).toBe(1); });", 'RC-156'],
    ["it('a', ({ skip }) => { skip(); expect(a).toBe(1); });", 'RC-156'],
    ["it('a', (ctx) => { ctx.skip(!db, 'no database'); expect(a).toBe(1); });", 'RC-156'],
    ["const dbTest = test.extend({});\ndbTest('a', () => { if (!rows.length) return; expect(rows[0]).toBe(1); });", 'RC-156'],
    ["export const deep = it.extend({});\nconst deeper = deep.extend({});\ndeeper.each([1])('a', () => { if (x) return; expect(a).toBe(1); });", 'RC-156'],
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

  it("production code's one allowed read: process.env.NODE_ENV === 'development' (PR #20)", async () => {
    const code = "const dev = process.env.NODE_ENV === 'development';\nexport const csp = dev ? 'relaxed' : 'strict';";
    expect(await lintSample(code, 'apps/web/proxy.ts')).toEqual([]);
  });

  it('a test with a fixed date, a loop of assertions and state kept inside one test', async () => {
    const code = [
      "import { expect, it } from 'vitest';",
      "const d = new Date('2026-11-07T00:00:00Z');",
      'for (const x of [1, 2]) expect(x).toBeGreaterThan(0);',
      "it('a', () => { let n = 1; n += 1; expect(n ?? 0).toBe(2); expect(() => d.toISOString()).not.toThrow(); });",
      // A return inside a helper the test calls, not in the test's own callback.
      "it('b', () => { const pick = (r: number[]) => { if (!r.length) return 0; return r[0]; }; expect(pick([2])).toBe(2); });",
      "const fmt = new Intl.DateTimeFormat('en-IN').format(d);",
    ].join('\n');
    expect(await lintSample(code, TEST)).toEqual([]);
  });

  // RAD-59's controls: loops that skip only work no assertion depends on, a switch's own break, and static skips.
  it('a loop whose continue or break skips no assertion, and a skip decided before the test', async () => {
    const code = [
      "import { expect, it, test } from 'vitest';",
      'for (const r of rows) { if (!r) continue; total += r; }',
      'expect(total).toBe(3);',
      'for (const r of rows) { switch (r) { case 1: n += 1; break; default: n += 2; } expect(n).toBeGreaterThan(0); }',
      "for (const r of rows) { const pick = (xs: number[]) => { for (const x of xs) { if (x) return x; } return 0; }; expect(pick(r)).toBe(1); }",
      "it.skip('later', () => { expect(1).toBe(1); });",
      "describe.skip('later', () => { it('a', () => { expect(1).toBe(1); }); });",
      "it.skipIf(!db)('needs a database', () => { expect(db).toBeTruthy(); });",
      "const dbTest = test.extend({});",
      "dbTest('b', () => { const first = (r: number[]) => { if (!r.length) return 0; return r[0]; }; expect(first([2])).toBe(2); });",
    ].join('\n');
    expect(await lintSample(code, TEST)).toEqual([]);
  });

  it('a relay pass that names its jobs, plainly or through spread options', async () => {
    const code = ["await relayOutbox(db, queue, log, { only: ['test.a'] });",
      "await relayOutbox(db, queue, log, { ...options, only });"].join('\n');
    expect(await lintSample(code, TEST)).toEqual([]);
  });

  it('the test helpers themselves, which tests may import', async () => {
    expect(await lintSample("import { factory } from '@radcore/test-helpers';\nexport { factory };", TEST)).toEqual([]);
  });
});
