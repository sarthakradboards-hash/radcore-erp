// The rolled-back "in the books" test transactions take turns (RAD-76). Each one posts several documents and holds what
// they lock until it rolls back, including number_counters rows that aren't committed yet, drawn in each file's own
// order (INV then CN, SO then DC then INV, ...). Overlapping, two of them deadlock on the counters' unique index. A
// shared transaction advisory lock, taken first, lets one run at a time, as the company row they all used to rewrite
// did, without that row's company-then-period ordering. Production saves are short and draw their number last.
import type { Ctx } from '@radcore/lib-platform';
import { sql } from 'drizzle-orm';
import { rawOf } from '../packages/db/src/tx.ts';

/** A fixed key for the books' turn; any other advisory lock in the tests uses its own. */
const BOOKS_TURN = 7_600_076;

/** Waits for, then holds until the transaction ends, the books' turn. The first statement of each such wrapper. */
export async function takeBooksTurn(ctx: Ctx): Promise<void> {
  await rawOf(ctx.tx).execute(sql`select pg_advisory_xact_lock(${BOOKS_TURN})`);
}
