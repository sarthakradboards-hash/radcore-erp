// ADR-002 §3 (RAD-115): locks.ts is in the SQL zone only for a numbering series' turn, a transaction advisory lock, and
// the draw that takes it in the same statement (RC-200). Its L1, L2 and L3 are relaxed, so this pins what it holds:
// exactly these statements, each key and value bound, and the period lock's move (RAD-157). A new lock adds its line
// here, in the same review.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const FILE = 'packages/db/src/locks.ts';

it('locks.ts makes exactly its pinned statements, every value bound', () => {
  const source = readFileSync(FILE, 'utf8');
  expect(source.match(/\.(query|execute|unsafe)\b/g)).toEqual(['.execute', '.execute', '.execute']);
  // Every mention of sql: its import and the three templates, so no sql.raw or other statement slips in.
  expect(source.match(/\bsql\b/g)).toHaveLength(4);
  expect(source.match(/sql`[^`]*`/g)?.map((s) => s.replace(/\s+/g, ' '))).toEqual([
    'sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`',
    'sql`with turn as (select pg_advisory_xact_lock(hashtextextended(${o.turn}, 0))) insert into radcore.number_counters (series, financial_year, prefix) '
      + 'select ${o.series}, ${o.financialYear}, ${o.prefix} from turn on conflict (series, financial_year) do update set last = radcore.number_counters.last '
      + 'returning last, prefix`',
    'sql`select radcore.set_period_lock(${through}::date)`',
  ]);
});
