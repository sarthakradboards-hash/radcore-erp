// What has come in against a purchase order's lines (M4-02, RAD-137; ADR-008 §5, §6): the received quantities of its
// receipts' lines, accepted and rejected alike, counted against what was ordered. A PO closes when every line has all
// it ordered, and one its receipts closed opens again when a cancelled receipt brings a line back below that; one a
// person closed short, with a reason, stays as it is (as ADR-007 §1 has sales orders do). A posted supplier return
// takes what it sent back off its PO lines, so the replacement comes in on the same PO (RAD-140, Sarthak, 23 Nov).
import {
  goodsReceiptLines, goodsReceipts, purchaseBillLines, purchaseBills, purchaseOrderLines, purchaseOrders, purchasingTx, supplierReturnLines,
  supplierReturns,
} from '@radcore/db/purchasing';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, ne, sum } from 'drizzle-orm';

/** Each PO line's received quantity: its posted receipts', and its drafts' too when `drafts` (a draft's own lines left
 * out by `except`, so it isn't counted against itself), less what posted supplier returns sent back. A line nothing has
 * come in on is 0. */
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
  const back = await purchasingTx(ctx).select({ orderLineId: goodsReceiptLines.orderLineId, qty: sum(supplierReturnLines.qty) })
    .from(supplierReturnLines).innerJoin(supplierReturns, eq(supplierReturns.id, supplierReturnLines.returnId))
    .innerJoin(goodsReceiptLines, eq(goodsReceiptLines.id, supplierReturnLines.receiptLineId))
    .where(and(inArray(goodsReceiptLines.orderLineId, [...new Set(orderLineIds)]), eq(supplierReturns.status, 'posted')))
    .groupBy(goodsReceiptLines.orderLineId);
  for (const r of back) got.set(r.orderLineId, (got.get(r.orderLineId) ?? dec('0')).minus(dec(r.qty ?? '0')));
  return got;
}

/** Each receipt line's quantity gone back on supplier returns: posted ones', and drafts' too when `drafts` (a draft's
 * own lines left out by `except`). For a return's limit, and a bill's (ADR-008 §7: less rejects returned before they
 * were billed). A line nothing went back on is 0. */
export async function returnedOf(ctx: Ctx, receiptLineIds: readonly string[], o: { drafts: boolean; except?: string }):
  Promise<Map<string, Decimal>> {
  const back = new Map(receiptLineIds.map((id) => [id, dec('0')]));
  if (receiptLineIds.length === 0) return back;
  const rows = await purchasingTx(ctx).select({ id: supplierReturnLines.receiptLineId, qty: sum(supplierReturnLines.qty) })
    .from(supplierReturnLines).innerJoin(supplierReturns, eq(supplierReturns.id, supplierReturnLines.returnId))
    .where(and(inArray(supplierReturnLines.receiptLineId, [...new Set(receiptLineIds)]),
      inArray(supplierReturns.status, o.drafts ? ['draft', 'posted'] : ['posted']),
      o.except === undefined ? undefined : ne(supplierReturns.id, o.except)))
    .groupBy(supplierReturnLines.receiptLineId);
  for (const r of rows) back.set(r.id, dec(r.qty ?? '0'));
  return back;
}

/** Which of these PO lines a bill not cancelled, draft or posted, names (RAD-138): such a line can't be removed or given
 * another item (`po_billed`), since the bill line names it by a restrict foreign key. With `posted`, only posted bills
 * count (a supplier return's guard until its debit note, RAD-140). */
export async function linesBilled(ctx: Ctx, orderLineIds: readonly string[], o: { posted?: boolean } = {}): Promise<Set<string>> {
  if (orderLineIds.length === 0) return new Set();
  const rows = await purchasingTx(ctx).select({ id: purchaseBillLines.poLineId }).from(purchaseBillLines)
    .innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId))
    .where(and(inArray(purchaseBillLines.poLineId, [...new Set(orderLineIds)]),
      o.posted === true ? eq(purchaseBills.status, 'posted') : ne(purchaseBills.status, 'cancelled')));
  return new Set(rows.flatMap((r) => (r.id === null ? [] : [r.id])));
}

/** Whether any receipt, draft or posted, names one of these PO lines: such a line can't be removed (`po_received`). */
export async function linesReceived(ctx: Ctx, orderLineIds: readonly string[]): Promise<Set<string>> {
  if (orderLineIds.length === 0) return new Set();
  const rows = await purchasingTx(ctx).select({ id: goodsReceiptLines.orderLineId }).from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .where(and(inArray(goodsReceiptLines.orderLineId, [...orderLineIds]), ne(goodsReceipts.status, 'cancelled')));
  return new Set(rows.map((r) => r.id));
}

/** Each receipt line's PO and PO line, by id, whoever made the receipt: for a supplier return the caller already holds
 * in its scope, so its PO is locked, checked and settled whoever can see that receipt (RAD-140, auditor-2 on #379). */
export async function receiptSources(ctx: Ctx, receiptLineIds: readonly string[]): Promise<Map<string, { orderId: string; orderLineId: string }>> {
  if (receiptLineIds.length === 0) return new Map();
  const rows = await purchasingTx(ctx).select({ id: goodsReceiptLines.id, orderId: goodsReceipts.orderId, orderLineId: goodsReceiptLines.orderLineId })
    .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .where(inArray(goodsReceiptLines.id, [...new Set(receiptLineIds)]));
  return new Map(rows.map(({ id, ...r }) => [id, r]));
}

/** Locks these POs in id order (ADR-008 §12: purchase orders first) for a document whose posting or cancelling settles
 * them (a supplier return, RAD-140), whoever made them, and answers their ids. */
export async function lockOrdersFor(ctx: Ctx, orderIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(orderIds)].sort();
  if (ids.length === 0) return [];
  const rows = await purchasingTx(ctx).select({ id: purchaseOrders.id }).from(purchaseOrders).where(inArray(purchaseOrders.id, ids))
    .orderBy(asc(purchaseOrders.id)).for('update');
  return rows.map((r) => r.id);
}

/** Settles each of these POs (`settleOrder`), read again under the lock `lockOrdersFor` took. */
export async function settleOrders(ctx: Ctx, orderIds: readonly string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const rows = await purchasingTx(ctx).select({ id: purchaseOrders.id, status: purchaseOrders.status, closeReason: purchaseOrders.closeReason })
    .from(purchaseOrders).where(inArray(purchaseOrders.id, [...orderIds]));
  for (const o of rows) await settleOrder(ctx, o);
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
