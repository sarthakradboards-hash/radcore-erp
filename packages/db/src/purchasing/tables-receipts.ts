// Goods receipts and QC (M4-02, RAD-137; ADR-008 §1, §2, §6; ADR-006 §4a, §5, §6, F2, F21), beside tables-orders.ts, one
// file per document family (ADR-008 §14). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument. A receipt posts
// through lib-stock's engine, and its posting and cancellation are guarded by #185's generic guards (guard_posted_document,
// guard_document_line), attached in its migration.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, qty, radcoreTable, unitPrice } from '../columns.ts';
import { items, locations, stockMovements } from '../stock/tables.ts';
import { purchaseOrderLines, purchaseOrders } from './tables-orders.ts';

/**
 * A goods receipt (§6): what arrived against one placed PO, counted at the door (a draft, inward:write), then split by
 * QC into accepted and rejected as it posts (inward:qc), numbered GRN. Accepted goods go to `location_id`, of a sellable
 * kind, and rejects to `rejects_location_id`, of kind `rejected`. Its supplier is its PO's, kept here for its batches
 * (RC-028) and its lists. Cancelling it mirrors it, dated the cancellation's day. Its owner is its maker (`created_by`).
 */
export const goodsReceipts = radcoreTable('goods_receipts', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  orderId: uuid().notNull().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  rejectsLocationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  // The supplier's delivery challan or invoice number, as written on their paper.
  supplierRef: boundedText({ max: 60 }),
  notes: boundedText({ max: 500 }),
  // Accepted plus rejected at the PO lines' rates, written as it posts: what Goods Received Not Billed accrued.
  value: money(),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_goods_receipts_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_goods_receipts_places', sql`${t.locationId} <> ${t.rejectsLocationId}`),
  // A posted receipt has its number and value; its entry, unless nothing on it had value (free goods, rate 0).
  check('ck_goods_receipts_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.value} is null)
    and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_goods_receipts_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_goods_receipts_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_goods_receipts_order').on(t.orderId),
  index('ix_goods_receipts_party').on(t.partyId),
  index('ix_goods_receipts_location').on(t.locationId),
  index('ix_goods_receipts_rejects_location').on(t.rejectsLocationId),
  index('ix_goods_receipts_created_by').on(t.createdBy),
  index('ix_goods_receipts_posted_entry').on(t.postedEntryId),
  index('ix_goods_receipts_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A receipt's line: what came of one PO line. A draft holds only `received`. Posting writes the QC (`accepted` and
 * `rejected`, adding up to it), the PO line's `rate` as it then stood, each part's value at that rate (to the paisa,
 * exactly what its movement and Goods Received Not Billed carry, which a bill clears), the two movements, and `qc`: the
 * batches and serials as the inspector named them.
 */
export const goodsReceiptLines = radcoreTable('goods_receipt_lines', {
  id: id(),
  receiptId: uuid().notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  orderLineId: uuid().notNull().references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  received: qty({ line: true }).notNull(),
  accepted: qty(),
  rejected: qty(),
  rate: unitPrice(),
  acceptedValue: money(),
  rejectedValue: money(),
  rejectReason: boundedText({ max: 300 }),
  acceptedMovementId: uuid().references(() => stockMovements.id, { onDelete: 'restrict' }),
  rejectedMovementId: uuid().references(() => stockMovements.id, { onDelete: 'restrict' }),
  qc: json(),
}, (t) => [
  // Unposted, none of the QC; posted, all of it, its parts adding up to what was received.
  check('ck_goods_receipt_lines_qc', sql`num_nulls(${t.accepted}, ${t.rejected}, ${t.rate}, ${t.acceptedValue}, ${t.rejectedValue}, ${t.qc}) in (0, 6)
    and (${t.accepted} is null or ${t.accepted} + ${t.rejected} = ${t.received})
    and (${t.accepted} is null or (${t.accepted} > 0) = (${t.acceptedMovementId} is not null))
    and (${t.rejected} is null or (${t.rejected} > 0) = (${t.rejectedMovementId} is not null))
    and (coalesce(${t.rejected}, 0) = 0 or ${t.rejectReason} is not null)`),
  uniqueIndex('ux_goods_receipt_lines_line').on(t.receiptId, t.lineNo),
  index('ix_goods_receipt_lines_order_line').on(t.orderLineId),
  index('ix_goods_receipt_lines_item').on(t.itemId),
  index('ix_goods_receipt_lines_accepted_movement').on(t.acceptedMovementId),
  index('ix_goods_receipt_lines_rejected_movement').on(t.rejectedMovementId),
]);
