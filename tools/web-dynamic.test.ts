// RC-146 (M1-46): every screen renders per request, so each gets its CSP nonce (apps/web/proxy.ts). A page built
// ahead of time carries no nonce, and the CSP then blocks its scripts. So no route file under apps/web/app may opt
// back into static rendering, and nothing may use Next's cache components, which ignore `dynamic` (RAD-53).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const WEB = 'apps/web';
const APP = 'apps/web/app';
const ROUTE_FILE = /(^|[\\/])(page|layout|template|default|not-found|route)\.tsx?$/;
const files = readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((f) => ROUTE_FILE.test(f));
const read = (f: string) => readFileSync(join(APP, f), 'utf8');

it('the root layout forces rendering per request', () => {
  expect(read('layout.tsx')).toMatch(/^export const dynamic = 'force-dynamic';$/m);
});

it('no route file opts into static rendering', () => {
  expect(files.length).toBeGreaterThan(0);
  const offenders = files.flatMap((f) => {
    const src = read(f);
    const dynamic = [...src.matchAll(/export\s+const\s+dynamic\s*=\s*(.+?);?\s*$/gm)].map((m) => m[1])
      .filter((v) => v !== "'force-dynamic'");
    const statics = src.match(/export\s+(const|let|var|async\s+function|function)\s+(revalidate|generateStaticParams)\b/g);
    return [...dynamic.map((v) => `${f}: dynamic = ${v}`), ...(statics ?? []).map((s) => `${f}: ${s}`)];
  });
  expect(offenders).toEqual([]);
});

it("no source file has a 'use cache' directive", () => {
  const sources = readdirSync(WEB, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/(^|[\\/])(node_modules|\.next)[\\/]/.test(f));
  expect(sources.length).toBeGreaterThan(0);
  // Any spelling of it: 'use cache', "use cache: private", `use cache: remote`.
  const offenders = sources.filter((f) => /^\s*(['"`])use cache\b[^'"`]*\1/m.test(readFileSync(join(WEB, f), 'utf8')));
  expect(offenders).toEqual([]);
});

it('next.config turns on no cache components', () => {
  // cacheComponents (and its earlier names) makes Next prerender and cache parts of a page, whatever `dynamic` says.
  expect(readFileSync(join(WEB, 'next.config.ts'), 'utf8')).not.toMatch(/cacheComponents|dynamicIO|useCache|ppr\b/);
});
