// ADR-002 §3 (RAD-31): log-writers.ts is in the SQL zone only for the calls to the database's log functions. Its L1,
// L2 and L3 are relaxed, so this pins what it holds: exactly these statements, each one `select` of one radcore log
// function with bound parameters. Adding record_access's caller adds its line here, in the same review.
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const FILE = 'packages/db/src/log-writers.ts';

it('log-writers.ts makes exactly its pinned calls, each a select of one radcore log function', () => {
  const source = readFileSync(FILE, 'utf8');
  expect(source.match(/\.(query|execute|unsafe)\b/g)).toEqual(['.execute']);
  expect(source.match(/sql`[^`]*`/g)).toEqual([
    'sql`select radcore.record_event(${e.kind}, ${e.userId}::uuid, ${e.device}, ${JSON.stringify(e.detail)}::jsonb)`',
  ]);
});

it("refuses sql outside an exported function there, so a helper can't hand out raw SQL", async () => {
  const lint = async (code: string) => (await new ESLint().lintText(code, { filePath: FILE }))[0]
    ?.messages.map((m) => m.ruleId);
  expect(await lint("import { sql } from 'drizzle-orm';\nconst q = sql`select 1`;\nexport const run = () => q;\n"))
    .toContain('radcore/no-sql');
  expect(await lint("import { sql } from 'drizzle-orm';\nexport function q() {\n  return sql`select 1`;\n}\n")).toEqual([]);
}, 60_000);
