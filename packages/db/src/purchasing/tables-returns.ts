// Supplier returns (M4-05, RAD-140; ADR-008 §1, §2, §8; ADR-006 §6, F4), beside tables-receipts.ts, one file per
// document family (ADR-008 §14). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument. A return posts through
// lib-stock's engine, and its posting and cancellation are guarded by #185's generic guards (guard_posted_document,
// guard_document_line), attached in its migration.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, qty, radcoreTable, unitPrice } from '../columns.ts';
import { items, locations, stockMovements } from '../stock/tables.ts';
import { goodsReceiptLines } from './tables-receipts.ts';

/**
 * A supplier return (§8): rejects taken back to their supplier out of `location_id`, a place of kind `rejected`, each
 * line naming the receipt line its goods came in on. Numbered SR as it posts. `unbilled_value` is what went back
 * against Goods Received Not Billed. Cancelling it mirrors it, dated the cancellation's day. Its owner is its maker.
 */
export const supplierReturns = radcoreTable('supplier_returns', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  reason: boundedText({ max: 500 }).notNull(),
  notes: boundedText({ max: 500 }),
  unbilledValue: money(),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_supplier_returns_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // A posted return has its number and value; its entry, unless nothing on it had value.
  check('ck_supplier_returns_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.unbilledValue} is null)
    and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_supplier_returns_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_supplier_returns_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_supplier_returns_party').on(t.partyId),
  index('ix_supplier_returns_location').on(t.locationId),
  index('ix_supplier_returns_created_by').on(t.createdBy),
  index('ix_supplier_returns_posted_entry').on(t.postedEntryId),
  index('ix_supplier_returns_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A return's line: how many of one receipt line's goods go back, and `picks`, the batches (by id) and serials named. A
 * draft holds those; posting writes the receipt line's `rate`, the unbilled part's quantity and value (what its movement
 * out carried) and the movement.
 */
export const supplierReturnLines = radcoreTable('supplier_return_lines', {
  id: id(),
  returnId: uuid().notNull().references(() => supplierReturns.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  receiptLineId: uuid().notNull().references(() => goodsReceiptLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  rate: unitPrice(),
  unbilledQty: qty(),
  unbilledValue: money(),
  movementId: uuid().references(() => stockMovements.id, { onDelete: 'restrict' }),
}, (t) => [
  // Unposted, none of these; posted, all of them, the unbilled part at most the line.
  check('ck_supplier_return_lines_posted', sql`num_nulls(${t.rate}, ${t.unbilledQty}, ${t.unbilledValue}, ${t.movementId}) in (0, 4)
    and (${t.unbilledQty} is null or ${t.unbilledQty} <= ${t.qty})`),
  uniqueIndex('ux_supplier_return_lines_line').on(t.returnId, t.lineNo),
  index('ix_supplier_return_lines_receipt_line').on(t.receiptLineId),
  index('ix_supplier_return_lines_item').on(t.itemId),
  index('ix_supplier_return_lines_movement').on(t.movementId),
]);
