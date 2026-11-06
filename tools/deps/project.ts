// Reads a project's files for tools/deps/checks.ts: the repo itself, or a fixture folder that overrides some of them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { AgeException, Lock, Manifest, Project } from './checks.ts';

const read = (file: string) => readFileSync(file, 'utf8');
const json = <T>(file: string) => JSON.parse(read(file)) as T;

/** ADR-003 §5's named exceptions to the 14-day rule: Next's 16.4.5 release set. tools/deps.test.ts ties each to §5's text. */
export const AGE_EXCEPTIONS: AgeException[] = ['next', 'eslint-config-next', '@next/env', '@next/eslint-plugin-next', '@next/swc-*']
  .map((name) => ({ name, version: '16.4.5' }));

/** The root package.json and every workspace's, from the root's `workspaces` globs (`dir/*`). */
function manifests(root: string): Manifest[] {
  const rootJson = json<Record<string, unknown>>(join(root, 'package.json'));
  const out: Manifest[] = [{ path: 'package.json', json: rootJson }];
  for (const pattern of (rootJson['workspaces'] ?? []) as string[]) {
    const dir = join(root, pattern.replace(/\/\*$/, ''));
    if (!existsSync(dir)) continue;
    for (const ws of readdirSync(dir).sort()) {
      const file = join(dir, ws, 'package.json');
      if (existsSync(file)) out.push({ path: relative(root, file).split(sep).join('/'), json: json(file) });
    }
  }
  return out;
}

/** Docker files anywhere outside node_modules (none until M8). */
function dockerfiles(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.next', 'boundary-fixtures'].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^Dockerfile|\.Dockerfile$/.test(e.name)) out.push({ path: relative(root, p).split(sep).join('/'), text: read(p) });
    }
  };
  walk(root);
  return out;
}

/**
 * The project at `root`. A fixture folder holds only what it changes (say, a package.json and a lockfile); the rest
 * comes from `defaults`, normally the repo.
 */
export function loadProject(root: string, defaults?: Project): Project {
  const has = (f: string) => existsSync(join(root, f));
  const or = <T>(f: string, get: () => T, fallback: T | undefined): T => (has(f) || fallback === undefined ? get() : fallback);
  return {
    manifests: or('package.json', () => manifests(root), defaults?.manifests),
    lock: or('package-lock.json', () => json<Lock>(join(root, 'package-lock.json')), defaults?.lock),
    nvmrc: or('.nvmrc', () => read(join(root, '.nvmrc')), defaults?.nvmrc),
    npmrc: or('.npmrc', () => read(join(root, '.npmrc')), defaults?.npmrc),
    dockerfiles: defaults && !readdirSync(root).some((f) => f.startsWith('Dockerfile')) ? defaults.dockerfiles : dockerfiles(root),
    installScripts: or('tools/install-scripts.json',
      () => json<{ packages: Project['installScripts'] }>(join(root, 'tools/install-scripts.json')).packages, defaults?.installScripts),
    adr: or('docs/architecture/adr/003-libraries.md', () => read(join(root, 'docs/architecture/adr/003-libraries.md')), defaults?.adr),
  };
}
