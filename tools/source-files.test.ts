// Every source file in the workspaces is TypeScript that the rules see. A .js, .mjs, .cjs, .jsx, .mts or .cts file
// would skip TypeScript's strict checks (allowJs has no checkJs) and could fall outside a rule's glob. A package.json
// "imports" alias (`#pg` for pg) or an aliased dependency (`"safe": "npm:pg@8"`) would hide the real package from
// L1, L4, L8 and L9.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// apps/web/public holds static files the browser fetches as they are; nothing there is built or linted.
const SKIP = new Set(['node_modules', '.next', join('apps', 'web', 'public')]);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (SKIP.has(e.name) || SKIP.has(p)) return [];
    return e.isDirectory() ? walk(p) : [p];
  });
const files = ['apps', 'packages'].flatMap(walk);
// A registry spec is a version or range; these prefixes and shapes point somewhere else.
const ELSEWHERE = /^(npm:|file:|link:|workspace:|portal:|patch:|git|github:|gitlab:|bitbucket:|https?:|\.|\/)|^[\w.-]+\/[\w.-]+/;
const manifests = ['package.json', ...files.filter((f) => f.endsWith('package.json'))]
  .map((f) => ({ f, json: JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown> }));

it('has only .ts and .tsx source under apps/ and packages/', () => {
  expect(files.filter((f) => /\.(c|m)?jsx?$|\.(c|m)ts$/.test(f))).toEqual([]);
});

it('declares no package.json "imports" aliases', () => {
  expect(manifests.filter(({ json }) => 'imports' in json).map(({ f }) => f)).toEqual([]);
});

it('takes every dependency from the registry by name, never through an alias, a path, git or a URL', () => {
  const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
  const bad = manifests.flatMap(({ f, json }) => FIELDS.flatMap((field) =>
    Object.entries((json[field] ?? {}) as Record<string, unknown>)
      .filter(([, spec]) => typeof spec !== 'string' || ELSEWHERE.test(spec))
      .map(([name, spec]) => `${f} ${field}.${name}: ${JSON.stringify(spec)}`)));
  expect(bad).toEqual([]);
});

it('catches each kind of non-registry spec', () => {
  for (const spec of ['npm:pg@8', 'file:../pg', 'link:../pg', 'git+https://x/pg.git', 'github:brianc/node-postgres',
    'https://x/pg.tgz', 'brianc/node-postgres', './pg']) expect(ELSEWHERE.test(spec), spec).toBe(true);
  for (const spec of ['8.23.1', '*', '^8.0.0']) expect(ELSEWHERE.test(spec), spec).toBe(false);
});
