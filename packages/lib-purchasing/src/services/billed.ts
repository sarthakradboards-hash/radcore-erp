// What posted purchase bills have billed of each goods receipt line (M4-03, RAD-138; ADR-008 §6, §7): a bill bills at
// most what's left of a receipt line (`over_received`), and a receipt any of it was billed on can't be cancelled
// (`receipt_in_use`). Every posted bill counts, whoever entered it, so this file reads past the record scope: E7's
// exemption, by the architect's ruling on RAD-138 (ADR-001 §6a). Its rules, checked in review:
// - it answers only quantities, keyed by the receipt-line ids its caller passes, net of cancelled bills: never a
//   bill's id, row, maker, number, supplier invoice number or value;
// - its caller has already scoped the receipt lines it asks about (receiptLinesFor), and a writer calls it under ADR-008
//   §12's locks (a bill holds its POs and receipts before itself; a receipt's cancel holds its PO, then the receipt).
import { purchaseBillLines, purchaseBills, purchasingTx } from '@radcore/db/purchasing';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray, sum } from 'drizzle-orm';
/** What posted bills not cancelled have billed of these receipt lines, by line (RAD-138): a receipt any of it was billed
 * on can't be cancelled (receipt_in_use, ADR-008 §6), and a bill bills at most what's left (over_received). */
export async function billedQty(ctx: Ctx, receiptLineIds: readonly string[]): Promise<Map<string, Decimal>> {
  const got = new Map(receiptLineIds.map((id) => [id, dec('0')]));
  if (receiptLineIds.length === 0) return got;
  const rows = await purchasingTx(ctx).select({ id: purchaseBillLines.receiptLineId, qty: sum(purchaseBillLines.qty) }).from(purchaseBillLines)
    .innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId))
    .where(and(inArray(purchaseBillLines.receiptLineId, [...new Set(receiptLineIds)]), eq(purchaseBills.status, 'posted')))
    .groupBy(purchaseBillLines.receiptLineId);
  for (const r of rows) if (r.id !== null) got.set(r.id, dec(r.qty ?? '0'));
  return got;
}
