// lib-stock's transfers, counts and adjustments (M4-06, RAD-141; ADR-008 §1, §2, §9, §10, §14; ADR-006 §6, F13, F14,
// F21), beside ./tables.ts, one file per document family (ADR-008 §14). SQL zone (ADR-002 §3): `sql` only as a CHECK's
// argument. Each posts through lib-stock's engine, and its posting and cancellation are guarded by #185's generic
// guards (guard_posted_document, guard_document_line), attached in its migration.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { journalEntries } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, qty, radcoreTable } from '../columns.ts';
import { batches, items, locations } from './tables.ts';

/** The posted-document columns every one of the three carries: its number, its entry, and how it was undone. */
const posting = () => ({
  status: text().notNull().default('draft'),
  number: text().unique(),
  businessDate: date({ mode: 'string' }).notNull(),
  reason: boundedText({ max: 500 }).notNull(),
  // Its stock entry; none when nothing it posts has value (a move between batches alone, F21).
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
});

/**
 * A transfer of goods from one location to another (§9, F13): posted at once, or, into a franchisee's place while
 * `stock.franchisee_transfer_approval` is on, kept as a draft until someone else approves (stock:approve). Its entry
 * is one Stock in Hand line per location (ADR-006 §7). Cancelling it mirrors it, dated the cancellation's day.
 */
export const stockTransfers = radcoreTable('stock_transfers', {
  id: id(), createdAt: createdMoment(),
  fromId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  toId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  ...posting(),
}, (t) => [
  check('ck_stock_transfers_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_stock_transfers_places', sql`${t.fromId} <> ${t.toId}`),
  check('ck_stock_transfers_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_stock_transfers_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_stock_transfers_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_stock_transfers_from').on(t.fromId),
  index('ix_stock_transfers_to').on(t.toId),
  index('ix_stock_transfers_created_by').on(t.createdBy),
  index('ix_stock_transfers_posted_entry').on(t.postedEntryId),
  index('ix_stock_transfers_cancel_entry').on(t.cancelEntryId),
]);

/** A transfer's line: an item's quantity and the batches and serials picked (`picks`), as the engine takes them. */
export const stockTransferLines = radcoreTable('stock_transfer_lines', {
  id: id(),
  transferId: uuid().notNull().references(() => stockTransfers.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  // The value it moved at, written as it posts.
  value: money(),
}, (t) => [
  uniqueIndex('ux_stock_transfer_lines_line').on(t.transferId, t.lineNo),
  index('ix_stock_transfer_lines_item').on(t.itemId),
]);

/**
 * A count of what's at a location as at `counted_at` (§10, RC-123): each line what was found, and once posted the book
 * quantity as at that moment, the difference (found less book) and its value. It changes nothing until someone other
 * than its counter approves (stock:approve), and approving posts the differences (F14, F21).
 */
export const stockCounts = radcoreTable('stock_counts', {
  id: id(), createdAt: createdMoment(),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  // When it was taken: the book quantity is the movements posted up to then (§10).
  countedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  ...posting(),
}, (t) => [
  check('ck_stock_counts_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_stock_counts_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_stock_counts_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_stock_counts_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_stock_counts_location').on(t.locationId),
  index('ix_stock_counts_created_by').on(t.createdBy),
  index('ix_stock_counts_posted_entry').on(t.postedEntryId),
  index('ix_stock_counts_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A count's line: an item and batch ("batch unknown" is null) and the quantity found, with the serials found for a
 * serialised item. One line per item and batch (RC-123): lines named twice are summed by the service, and the unique
 * key holds it. Posting writes the book quantity, the difference and its value, all at once.
 */
export const stockCountLines = radcoreTable('stock_count_lines', {
  id: id(),
  countId: uuid().notNull().references(() => stockCounts.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  batchId: uuid().references(() => batches.id, { onDelete: 'restrict' }),
  found: qty().notNull(),
  serials: json().notNull(),
  book: qty({ signed: true }),
  difference: qty({ signed: true }),
  value: money({ signed: true }),
}, (t) => [
  unique('ux_stock_count_lines_item_batch').on(t.countId, t.itemId, t.batchId).nullsNotDistinct(),
  uniqueIndex('ux_stock_count_lines_line').on(t.countId, t.lineNo),
  index('ix_stock_count_lines_item').on(t.itemId),
  index('ix_stock_count_lines_batch').on(t.batchId),
  check('ck_stock_count_lines_posted', sql`num_nulls(${t.book}, ${t.difference}, ${t.value}) in (0, 3)`),
]);

/**
 * A one-off adjustment at a location with a reason (§10): goods damaged or lost (`out`), or found (`in`). Like a count,
 * it changes nothing until someone else approves (stock:approve), and approving posts it (F14).
 */
export const stockAdjustments = radcoreTable('stock_adjustments', {
  id: id(), createdAt: createdMoment(),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  ...posting(),
}, (t) => [
  check('ck_stock_adjustments_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_stock_adjustments_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_stock_adjustments_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_stock_adjustments_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_stock_adjustments_location').on(t.locationId),
  index('ix_stock_adjustments_created_by').on(t.createdBy),
  index('ix_stock_adjustments_posted_entry').on(t.postedEntryId),
  index('ix_stock_adjustments_cancel_entry').on(t.cancelEntryId),
]);

/** An adjustment's line: in or out, an item's quantity in its batches, and for a serialised item its units (a found
 * one with its condition and, where the item keeps one, its chassis number). Posting writes its value. */
export const stockAdjustmentLines = radcoreTable('stock_adjustment_lines', {
  id: id(),
  adjustmentId: uuid().notNull().references(() => stockAdjustments.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  direction: text().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  condition: text(),
  value: money(),
}, (t) => [
  check('ck_stock_adjustment_lines_direction', sql`${t.direction} in ('in', 'out')`),
  // A found unit's condition is only for goods coming in.
  check('ck_stock_adjustment_lines_condition', sql`${t.condition} is null or ${t.direction} = 'in'`),
  uniqueIndex('ux_stock_adjustment_lines_line').on(t.adjustmentId, t.lineNo),
  index('ix_stock_adjustment_lines_item').on(t.itemId),
]);
