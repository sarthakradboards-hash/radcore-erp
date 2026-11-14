// Why a change was made (RAD-36, ADR-005 §7c). A write whose contract asks for a reason (lib-common's reason()) has
// it kept once, in change_reasons, by the generic handler, before the service runs; every audit row the change writes
// then carries its id. The text never enters the append-only audit log.
import { recordReason } from '@radcore/db/log-writers';
import type { Ctx } from './ctx.ts';

/** Keeps `reason` for this transaction's change: its audit rows point at it. */
export async function recordChangeReason(ctx: Ctx, reason: string): Promise<void> {
  await recordReason(ctx.tx, reason);
}
