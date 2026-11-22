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
