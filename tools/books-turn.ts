// The rolled-back "in the books" test transactions take turns (RAD-76). Each one posts several documents and holds what
// they lock until it rolls back, including number_counters rows that aren't committed yet, drawn in each file's own
// order (INV then CN, SO then DC then INV, ...). Overlapping, two of them deadlock on the counters' unique index. A
// shared transaction advisory lock, taken first, lets one run at a time, as the company row they all used to rewrite
// did, without that row's company-then-period ordering. Production saves are short and draw their number last.
// A test transaction that posts and then confirms an order holds the journal's series turn and wants the order's, against
// ADR-006 §1 step 6's order (sales.quote, sales.order, the journal, the rest by key; the architect on RAD-115): it
// should confirm first, or holdSeries both up front.
import type { Ctx } from '@radcore/lib-platform';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { rawOf } from '../packages/db/src/tx.ts';

/** A fixed key for the books' turn; any other advisory lock in the tests uses its own. */
const BOOKS_TURN = 7_600_076;

/** Waits for, then holds until the transaction ends, the books' turn. The first statement of each such wrapper. */
export async function takeBooksTurn(ctx: Ctx): Promise<void> {
  await rawOf(ctx.tx).execute(sql`select pg_advisory_xact_lock(${BOOKS_TURN})`);
}

/**
 * How many of these series' numbering turns (lib-platform's `numbering.<key>` advisory locks) backend `pid` holds, read
 * from pg_locks: a bigint key is classid (its high 32 bits), objid (its low 32) and objsubid 1. A try-lock can't do
 * this: it fails while any other file's save holds the same series' turn, such as the journal's (RAD-141, dev e77c225b).
 */
export async function turnsHeldBy(db: pg.Pool, pid: number | undefined, keys: readonly string[], o: { waiting?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int n from pg_locks l
    join unnest($2::text[]) k on true
    where l.pid = $1 and l.locktype = 'advisory' and l.granted = $3 and l.objsubid = 1
      and l.classid::bigint = (hashtextextended('numbering.' || k, 0) >> 32) & 4294967295
      and l.objid::bigint = hashtextextended('numbering.' || k, 0) & 4294967295`, [pid, keys, o.waiting !== true]);
  return rows[0]?.n ?? -1;
}
