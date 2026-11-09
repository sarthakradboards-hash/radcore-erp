// RC-146 (M1-46): every screen renders per request, so each gets its CSP nonce (apps/web/proxy.ts). A page built
// ahead of time carries no nonce, and the CSP then blocks its scripts. So no route file under apps/web/app may opt
// back into static rendering.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

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
