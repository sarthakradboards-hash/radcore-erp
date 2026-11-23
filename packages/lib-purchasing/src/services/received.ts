// What has come in against a purchase order's lines (M4-02, RAD-137; ADR-008 §5, §6): the received quantities of its
// receipts' lines, accepted and rejected alike, counted against what was ordered. A PO closes when every line has all
// it ordered, and one its receipts closed opens again when a cancelled receipt brings a line back below that; one a
// person closed short, with a reason, stays as it is (as ADR-007 §1 has sales orders do).
import { goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray, ne, sum } from 'drizzle-orm';

/** Each PO line's received quantity: its posted receipts', and its drafts' too when `drafts` (a draft's own lines left
 * out by `except`, so it isn't counted against itself). A line nothing has come in on is 0. */
export async function receivedOf(ctx: Ctx, orderLineIds: readonly string[], o: { drafts: boolean; except?: string }):
  Promise<Map<string, Decimal>> {
  const got = new Map(orderLineIds.map((id) => [id, dec('0')]));
  if (orderLineIds.length === 0) return got;
  const rows = await purchasingTx(ctx).select({ orderLineId: goodsReceiptLines.orderLineId, qty: sum(goodsReceiptLines.received) })
    .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .where(and(inArray(goodsReceiptLines.orderLineId, [...new Set(orderLineIds)]),
      inArray(goodsReceipts.status, o.drafts ? ['draft', 'posted'] : ['posted']),
      o.except === undefined ? undefined : ne(goodsReceipts.id, o.except)))
    .groupBy(goodsReceiptLines.orderLineId);
  for (const r of rows) got.set(r.orderLineId, dec(r.qty ?? '0'));
  return got;
}

/** Whether any receipt, draft or posted, names one of these PO lines: such a line can't be removed (`po_received`). */
export async function linesReceived(ctx: Ctx, orderLineIds: readonly string[]): Promise<Set<string>> {
  if (orderLineIds.length === 0) return new Set();
  const rows = await purchasingTx(ctx).select({ id: goodsReceiptLines.orderLineId }).from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .where(and(inArray(goodsReceiptLines.orderLineId, [...orderLineIds]), ne(goodsReceipts.status, 'cancelled')));
  return new Set(rows.map((r) => r.id));
}

/** Closes a placed PO once every line has all it ordered, and opens again one its receipts closed (no reason) once a
 * line is below that; a PO closed short stays closed. Under the PO's lock. */
export async function settleOrder(ctx: Ctx, order: { id: string; status: string; closeReason: string | null }): Promise<void> {
  if (order.closeReason !== null || (order.status !== 'placed' && order.status !== 'closed')) return;
  const tx = purchasingTx(ctx);
  const lines = await tx.select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.qty }).from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, order.id));
  const got = await receivedOf(ctx, lines.map((l) => l.id), { drafts: false });
  const all = lines.every((l) => (got.get(l.id) ?? dec('0')).gte(dec(l.qty)));
  const status = all ? 'closed' : 'placed';
  if (status !== order.status) await tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, order.id));
}
