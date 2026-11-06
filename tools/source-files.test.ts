// Every source file in the workspaces is TypeScript that the rules see. A .js, .mjs, .cjs, .jsx, .mts or .cts file
// would skip TypeScript's strict checks (allowJs has no checkJs) and could fall outside a rule's glob. A package.json
// "imports" alias (`#pg` for pg) or a dependency taken from anywhere but the registry (`"safe": "npm:pg@8"`, a
// tarball, a path, git) would hide the real package from L1, L4, L8 and L9.
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
const manifests = ['package.json', ...files.filter((f) => f.endsWith('package.json'))]
  .map((f) => ({ f, json: JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown> }));

// An allowlist of registry specs: a version or range (each `||` alternative made of comparators or a hyphen range),
// a dist-tag, or an `overrides` reference to a root dependency (`$name`). Anything else (`npm:`, `file:`, `git+…`,
// `user/repo`, `pg.tgz`, `~/pg`, `C:/pg`, a URL) points somewhere npm would fetch from or alias.
const COMPARATOR = /^(?:[<>]=?|=|~|\^)?v?(?:\*|x|X|\d+)(?:\.(?:\*|x|X|\d+)){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TAG = /^[a-z][a-z0-9-]*$/;
const isRegistrySpec =(spec: string): boolean => {
  if (TAG.test(spec) || /^\$[@\w./-]+$/.test(spec)) return true;
  return spec.split('||').every((alt) => {
    const parts = alt.trim().split(/\s+/).filter((p) => p !== '-');
    return parts.length > 0 && parts.every((p) => COMPARATOR.test(p));
  });
};
// Every spec in a dependency field; `overrides` nest objects (`{ "foo": { ".": "1.0.0", "bar": "2.0.0" } }`).
const specs = (value: unknown, path: string): [string, unknown][] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => specs(v, `${path}.${k}`))
    : [[path, value]];

it('has only .ts and .tsx source under apps/ and packages/', () => {
  expect(files.filter((f) => /\.(c|m)?jsx?$|\.(c|m)ts$/.test(f))).toEqual([]);
});

it('declares no package.json "imports" aliases', () => {
  expect(manifests.filter(({ json }) => 'imports' in json).map(({ f }) => f)).toEqual([]);
});

it('takes every dependency from the registry by name, never through an alias, a path, a tarball, git or a URL', () => {
  const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
  const bad = manifests.flatMap(({ f, json }) => FIELDS.flatMap((field) =>
    specs(json[field] ?? {}, field).filter(([, spec]) => typeof spec !== 'string' || !isRegistrySpec(spec))
      .map(([path, spec]) => `${f} ${path}: ${JSON.stringify(spec)}`)));
  expect(bad).toEqual([]);
});

it('tells registry specs from everything else', () => {
  for (const spec of ['npm:pg@8', 'file:../pg', 'link:../pg', 'git+https://x/pg.git', 'github:brianc/node-postgres',
    'gist:abc', 'https://x/pg.tgz', 'brianc/node-postgres', './pg', 'pg.tgz', 'pg.tar', '~/pg.tgz', 'C:/pg', 'C:\\pg', '']) {
    expect(isRegistrySpec(spec), spec).toBe(false);
  }
  for (const spec of ['8.23.1', '*', '^8.0.0', '~8.1', '>=1.2.3 <2', '1.2.3 - 1.4.0', '1.x || >=2.5.0', '1.0.0-rc.5',
    'latest', '$typescript']) {
    expect(isRegistrySpec(spec), spec).toBe(true);
  }
  expect(specs({ foo: { '.': '1.0.0', bar: '$bar' } }, 'overrides')).toEqual([
    ['overrides.foo..', '1.0.0'], ['overrides.foo.bar', '$bar']]);
});
