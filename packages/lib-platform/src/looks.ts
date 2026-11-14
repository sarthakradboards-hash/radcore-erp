// Who looked (ADR-005 §7c, M1-22, RAD-40): the generic handler logs each record a principal saw a pii() value of
// unmasked, against its piiRecord's table: a write in its own transaction, a read in a short write once it commits.
import { recordAccesses } from '@radcore/db/log-writers';
import type { Look } from '@radcore/lib-common';
import type { Ctx } from './ctx.ts';

/** One access_log row per record, by the request's principal, in one statement. */
export async function recordLooks(ctx: Ctx, looks: readonly Look[]): Promise<void> {
  if (looks.length > 0) await recordAccesses(ctx.tx, looks);
}
