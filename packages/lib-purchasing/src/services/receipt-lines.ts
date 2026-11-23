// The receipt lines a purchase bill or a supplier return matches (M4-03 and M4-05; ADR-008 §7, §8, §12), reached by no
// route, apart from receipts.ts to keep it under E2's 400 lines.
import { goodsReceiptLines, goodsReceipts, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { listScope, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray } from 'drizzle-orm';

/**
 * For a purchase bill (M4-03, backend's RAD-138), reached by no route: posted receipt lines as the bill matches them,
 * with what each accrued to Goods Received Not Billed at receipt (`acceptedValue`, `rejectedValue`), which the bill
 * clears exactly. Locked when `forUpdate`, after their POs and before the bill (ADR-008 §12): receipts in id order.
 */
export async function receiptLinesFor(ctx: Ctx, lineIds: readonly string[], o: { forUpdate: boolean }) {
  if (lineIds.length === 0) return [];
  const tx = purchasingTx(ctx);
  const q = tx.select({ id: goodsReceiptLines.id, receiptId: goodsReceipts.id, receiptNumber: goodsReceipts.number,
    receiptDate: goodsReceipts.businessDate, status: goodsReceipts.status, supplierId: goodsReceipts.partyId, orderId: goodsReceipts.orderId,
    orderNumber: purchaseOrders.number, orderLineId: goodsReceiptLines.orderLineId, itemId: goodsReceiptLines.itemId,
    received: goodsReceiptLines.received, accepted: goodsReceiptLines.accepted, rejected: goodsReceiptLines.rejected, rate: goodsReceiptLines.rate,
    acceptedValue: goodsReceiptLines.acceptedValue, rejectedValue: goodsReceiptLines.rejectedValue,
    acceptedMovementId: goodsReceiptLines.acceptedMovementId, rejectedMovementId: goodsReceiptLines.rejectedMovementId,
    locationId: goodsReceipts.locationId, rejectsLocationId: goodsReceipts.rejectsLocationId, owner: goodsReceipts.createdBy })
    .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.orderId))
    // Scoped in the query, so a receipt the caller can't see is neither answered nor locked (auditor-2 on #367).
    .where(and(inArray(goodsReceiptLines.id, [...lineIds]), listScope(ctx, 'purchasing:read', goodsReceipts.createdBy)))
    .orderBy(asc(goodsReceipts.id), asc(goodsReceiptLines.lineNo));
  if (!o.forUpdate) return q;
  // Their POs are already held by the bill, FOR SHARE (§12), so this takes only the receipts' own rows, in id order: a
  // FOR UPDATE on the join would take the POs too, and two bills on one PO would deadlock (the auditor on #380).
  const receiptIds = [...new Set((await q).map((r) => r.receiptId))].sort();
  if (receiptIds.length > 0) {
    await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(inArray(goodsReceipts.id, receiptIds)).orderBy(asc(goodsReceipts.id)).for('update');
  }
  // Read again under the lock (awaiting `q` runs it anew), so each receipt's status is the one now held, not the one
  // seen before the lock (backend-3 on #380): don't fold this into the read above.
  return await q;
}
