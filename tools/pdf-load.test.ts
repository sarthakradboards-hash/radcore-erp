// RAD-159 (RC-135; auditor-2 on #438): the api never loads the PDF library. lib-platform's entry, which the api
// imports, names the PDF reader's types only; unpdf loads in the PDF reader's own worker thread. A child process loads
// the entry with a resolve hook and lists every specifier it resolves.
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const PROBE = `
import { registerHooks } from 'node:module';
const seen = [];
registerHooks({ resolve(specifier, context, next) { seen.push(specifier); return next(specifier, context); } });
await import('@radcore/lib-platform');
console.log(JSON.stringify({ unpdf: seen.filter((s) => s.includes('unpdf')), parsed: seen.length > 0 }));
`;

it("loads lib-platform's entry without unpdf", { timeout: 60_000 }, () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({ unpdf: [], parsed: true });
});
