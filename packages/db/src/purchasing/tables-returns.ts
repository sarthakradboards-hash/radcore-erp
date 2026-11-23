// Supplier returns (M4-05, RAD-140; ADR-008 §1, §2, §8; ADR-006 §6, F4), beside tables-receipts.ts, one file per
// document family (ADR-008 §14). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument. A return posts through
// lib-stock's engine, and its posting and cancellation are guarded by #185's generic guards (guard_posted_document,
// guard_document_line), attached in its migration.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, percent, qty, radcoreTable, unitPrice } from '../columns.ts';
import { items, locations, stockMovements } from '../stock/tables.ts';
import { purchaseBillLines, purchaseBills } from './tables-bills.ts';
import { goodsReceiptLines } from './tables-receipts.ts';

/**
 * A supplier return (§8): rejects taken back to their supplier out of `location_id`, a place of kind `rejected`, each
 * line naming the receipt line its goods came in on. Numbered SR as it posts. `unbilled_value` is what went back
 * against Goods Received Not Billed. Its billed part is its debit note (RAD-140 PR 2): numbered DBN, its figures at the
 * bills' rates, `total` what it credits the supplier (a payable credit, ADR-005 §7a, applied to those bills). Cancelling it
 * mirrors it, dated the cancellation's day. Its owner is its maker.
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
  debitNoteNumber: text(),
  placeOfSupply: text(), taxable: money(), cgst: money(), sgst: money(), igst: money(), roundOff: money({ signed: true }), total: money(),
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
  // The debit note's figures: all or none, a draft none, its total the lines' sum and round-off, and a number only with them.
  check('ck_supplier_returns_debit', sql`num_nulls(${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.roundOff}, ${t.total}) in (0, 6)
    and (${t.status} <> 'draft' or ${t.total} is null) and (${t.debitNoteNumber} is null or ${t.total} is not null)
    and (${t.total} is null or (${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.roundOff} and abs(${t.roundOff}) < 1))`),
  uniqueIndex('ux_supplier_returns_debit_note_number').on(t.debitNoteNumber),
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

/**
 * A return line's billed part against one bill line (§8, the architect on RAD-140): how many, debited at that bill line's
 * rate and GST rate. Written as the return posts, its bills latest first; the return's debit note is their sum.
 */
export const supplierReturnDebits = radcoreTable('supplier_return_debits', {
  id: id(),
  returnId: uuid().notNull().references(() => supplierReturns.id, { onDelete: 'cascade' }),
  returnLineId: uuid().notNull().references(() => supplierReturnLines.id, { onDelete: 'cascade' }),
  billId: uuid().notNull().references(() => purchaseBills.id, { onDelete: 'restrict' }),
  billLineId: uuid().notNull().references(() => purchaseBillLines.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  rate: unitPrice().notNull(),
  gstRate: percent(),
  taxable: money().notNull(), cgst: money().notNull(), sgst: money().notNull(), igst: money().notNull(),
}, (t) => [
  uniqueIndex('ux_supplier_return_debits_line').on(t.returnLineId, t.billLineId),
  index('ix_supplier_return_debits_return').on(t.returnId),
  index('ix_supplier_return_debits_bill').on(t.billId),
  index('ix_supplier_return_debits_bill_line').on(t.billLineId),
]);
