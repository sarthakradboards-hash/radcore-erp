// Who looked (ADR-005 §7c, M1-22, RAD-40): the generic handler logs each record a principal saw a pii() value of
// unmasked, in a short write of its own once the read commits, before the answer goes out.
import { recordAccess } from '@radcore/db/log-writers';
import type { Ctx } from './ctx.ts';

/** One access_log row per record, by the request's principal. */
export async function recordLooks(ctx: Ctx, table: string, ids: readonly string[]): Promise<void> {
  // shortcut: one call per record, a list page being 200 at most; send them in one statement if a bigger answer logs.
  for (const id of ids) await recordAccess(ctx.tx, table, id);
}
