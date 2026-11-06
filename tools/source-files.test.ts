// Every source file in the workspaces is TypeScript that the rules see. A .js, .mjs, .cjs, .jsx, .mts or .cts file
// would skip TypeScript's strict checks (allowJs has no checkJs) and could fall outside a rule's glob. A package.json
// "imports" alias (`#pg` for pg) would hide the real specifier from L1, L4, L8 and L9.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const SKIP = new Set(['node_modules', '.next']);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = ['apps', 'packages'].flatMap(walk);

it('has only .ts and .tsx source under apps/ and packages/', () => {
  expect(files.filter((f) => /\.(c|m)?jsx?$|\.(c|m)ts$/.test(f))).toEqual([]);
});

it('declares no package.json "imports" aliases', () => {
  const withImports = files.filter((f) => f.endsWith('package.json'))
    .filter((f) => 'imports' in (JSON.parse(readFileSync(f, 'utf8')) as object));
  expect(withImports).toEqual([]);
});
