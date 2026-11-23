// lib-stock's job work (M4-07, RAD-142; ADR-008 §1, §2, §11, §14; ADR-006 §6, F16), beside ./tables.ts, one file per
// document family (ADR-008 §14). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument. A challan sends inputs to a
// job worker's own place; a receipt accounts for them: goods made, used, back and lost. Each is inserted as a draft,
// given its lines and posted in one save, through lib-stock's engine; #185's generic guards keep it as posted after
// that, attached in its migration.
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, qty, radcoreTable, unitPrice } from '../columns.ts';
import { items, locations } from './tables.ts';

/** The posted-document columns both carry: its number, its entry, and how it was undone. */
const posting = () => ({
  status: text().notNull().default('draft'),
  number: text().unique(),
  businessDate: date({ mode: 'string' }).notNull(),
  notes: boundedText({ max: 500 }),
  // Its stock entry; none when nothing it posts has value.
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
});

/**
 * A job work challan (§11, F16): inputs sent from a place of ours (`from_id`) to the job worker's own place (`to_id`,
 * of kind `job_work`, whose `party_id` is `party_id`). Rule 55's delivery challan for goods sent for job work.
 */
export const jobWorkChallans = radcoreTable('job_work_challans', {
  id: id(), createdAt: createdMoment(),
  fromId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  toId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  ...posting(),
}, (t) => [
  check('ck_job_work_challans_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_job_work_challans_places', sql`${t.fromId} <> ${t.toId}`),
  check('ck_job_work_challans_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_job_work_challans_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_job_work_challans_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_job_work_challans_party').on(t.partyId),
  index('ix_job_work_challans_from').on(t.fromId),
  index('ix_job_work_challans_to').on(t.toId),
  index('ix_job_work_challans_created_by').on(t.createdBy),
  index('ix_job_work_challans_posted_entry').on(t.postedEntryId),
  index('ix_job_work_challans_cancel_entry').on(t.cancelEntryId),
]);

/** A challan's line: an input's quantity and the batches and serials picked (`picks`), and the value it went at. */
export const jobWorkChallanLines = radcoreTable('job_work_challan_lines', {
  id: id(),
  challanId: uuid().notNull().references(() => jobWorkChallans.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  value: money(),
}, (t) => [
  uniqueIndex('ux_job_work_challan_lines_line').on(t.challanId, t.lineNo),
  index('ix_job_work_challan_lines_item').on(t.itemId),
]);

/**
 * A job work receipt (§11, F16): it answers its challan's lines, bringing goods made and inputs back into `location_id`,
 * one of ours. Its number names the batch of what it made (RC-130). Its charges accrue to Job Work Charges to be Billed.
 */
export const jobWorkReceipts = radcoreTable('job_work_receipts', {
  id: id(), createdAt: createdMoment(),
  challanId: uuid().notNull().references(() => jobWorkChallans.id, { onDelete: 'restrict' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  charges: money(),
  ...posting(),
}, (t) => [
  check('ck_job_work_receipts_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_job_work_receipts_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_job_work_receipts_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  index('ix_job_work_receipts_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_job_work_receipts_challan').on(t.challanId),
  index('ix_job_work_receipts_location').on(t.locationId),
  index('ix_job_work_receipts_created_by').on(t.createdBy),
  index('ix_job_work_receipts_posted_entry').on(t.postedEntryId),
  index('ix_job_work_receipts_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A receipt's line, answering one challan line: what was made from it (an item, quantity and charge rate, with its
 * serials), and of the inputs, what was used, what came back and what was lost, each with its picks. Posting writes
 * the values: the inputs used, the charge, and the lost inputs' worth.
 */
export const jobWorkReceiptLines = radcoreTable('job_work_receipt_lines', {
  id: id(),
  receiptId: uuid().notNull().references(() => jobWorkReceipts.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  challanLineId: uuid().notNull(),
  madeItemId: uuid().references(() => items.id, { onDelete: 'restrict' }),
  madeQty: qty({ line: true }),
  chargeRate: unitPrice(),
  madeSerials: json(),
  used: qty().notNull(),
  usedPicks: json().notNull(),
  back: qty().notNull(),
  backPicks: json().notNull(),
  lost: qty().notNull(),
  lostPicks: json().notNull(),
  usedValue: money(),
  charge: money(),
  lostValue: money(),
}, (t) => [
  uniqueIndex('ux_job_work_receipt_lines_line').on(t.receiptId, t.lineNo),
  // Named, as the generated name runs past 63 bytes.
  foreignKey({ name: 'fk_job_work_receipt_lines_challan_line', columns: [t.challanLineId], foreignColumns: [jobWorkChallanLines.id] })
    .onDelete('restrict'),
  index('ix_job_work_receipt_lines_challan_line').on(t.challanLineId),
  index('ix_job_work_receipt_lines_made_item').on(t.madeItemId),
  // Goods made are named whole: their item, quantity and charge rate together, or none.
  check('ck_job_work_receipt_lines_made', sql`(${t.madeItemId} is null) = (${t.madeQty} is null) and (${t.madeItemId} is null) = (${t.chargeRate} is null)`),
  check('ck_job_work_receipt_lines_parts', sql`${t.used} >= 0 and ${t.back} >= 0 and ${t.lost} >= 0 and ${t.used} + ${t.back} + ${t.lost} > 0`),
]);
