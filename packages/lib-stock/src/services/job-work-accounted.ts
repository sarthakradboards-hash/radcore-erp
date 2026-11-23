// What a job work challan's receipts have accounted for (M4-07, RAD-142; ADR-008 §11): each challan line's used, back
// and lost, summed over its posted receipts, and whether any posted receipt answers a challan. Every receipt counts,
// whoever made it, as the answers are about the challan, not a person: so this file reads past the record scope, and
// is exempt from E7, as purchasing's received.ts is. Its rules: each export answers only quantities and a yes or no,
// keyed by the challan and challan-line ids its caller passed in, never another document's row; the caller has already
// applied ctx.see to that challan; and a writer calls it only after locking the challan (§12), so the sums can't move
// under its check (the architect on RAD-142).
import { jobWorkReceiptLines, jobWorkReceipts, stockTx } from '@radcore/db/stock';
import { dec, roundQty, type Quantity } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray } from 'drizzle-orm';

/** What each challan line's posted receipts have accounted for: used, back and lost, by challan line. */
export async function accountedFor(ctx: Ctx, lineIds: readonly string[]): Promise<Map<string, { used: Quantity; back: Quantity; lost: Quantity }>> {
  if (lineIds.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ line: jobWorkReceiptLines.challanLineId, used: jobWorkReceiptLines.used, back: jobWorkReceiptLines.back,
    lost: jobWorkReceiptLines.lost }).from(jobWorkReceiptLines)
    .innerJoin(jobWorkReceipts, and(eq(jobWorkReceipts.id, jobWorkReceiptLines.receiptId), eq(jobWorkReceipts.status, 'posted')))
    .where(inArray(jobWorkReceiptLines.challanLineId, [...lineIds]));
  const out = new Map<string, { used: Quantity; back: Quantity; lost: Quantity }>();
  for (const r of rows) {
    const was = out.get(r.line) ?? { used: roundQty('0', 3), back: roundQty('0', 3), lost: roundQty('0', 3) };
    out.set(r.line, { used: roundQty(dec(was.used).plus(r.used), 3), back: roundQty(dec(was.back).plus(r.back), 3), lost: roundQty(dec(was.lost).plus(r.lost), 3) });
  }
  return out;
}

/** Whether a posted receipt answers the challan: it can't be cancelled while one does (`challan_answered`). */
export async function answered(ctx: Ctx, challanId: string): Promise<boolean> {
  const [row] = await stockTx(ctx).select({ id: jobWorkReceipts.id }).from(jobWorkReceipts)
    .where(and(eq(jobWorkReceipts.challanId, challanId), eq(jobWorkReceipts.status, 'posted'))).limit(1);
  return row !== undefined;
}
