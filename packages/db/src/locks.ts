// Transaction advisory locks (ADR-006 §1 step 6, RAD-115): a turn on a named key, held to the transaction's end, for a
// lock with no row to take, such as a numbering series before its year's first number. The SQL is fixed here and the
// key is bound, so a library takes a turn without raw SQL of its own (L1). Collisions of hashtextextended only make two
// keys take turns together, never wrong.
import { sql } from 'drizzle-orm';
import { rawOf, type Tx } from './tx.ts';

/** Takes each key's turn in the order given, waiting while another transaction holds it. One already held is free. */
export async function takeTurns(tx: Tx, keys: readonly string[]): Promise<void> {
  for (const key of keys) await rawOf(tx).execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * A numbering series' next count, in one statement (RC-200), with its series' turn taken first (ADR-006 §1 step 6,
 * RAD-115): the insert selects from the turn's CTE, so the lock is held before the counter row is touched. The
 * counter's trigger makes `last` one more on a conflict and gives a year's first row its prefix (migration 0038 and
 * RAD-132's). Only lib-platform's nextNumber calls it.
 */
export async function drawCounter(tx: Tx, o: { turn: string; series: string; financialYear: string; prefix: string }):
  Promise<{ last: number; prefix: string } | undefined> {
  const result = await rawOf(tx).execute(sql`with turn as (select pg_advisory_xact_lock(hashtextextended(${o.turn}, 0)))
    insert into radcore.number_counters (series, financial_year, prefix) select ${o.series}, ${o.financialYear}, ${o.prefix} from turn
    on conflict (series, financial_year) do update set last = radcore.number_counters.last returning last, prefix`);
  return (result as unknown as { rows: { last: number; prefix: string }[] }).rows[0];
}
