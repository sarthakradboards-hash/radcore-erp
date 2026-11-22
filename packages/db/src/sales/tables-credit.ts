// lib-sales's credit notes (M3-10, RAD-114; ADR-007 §6; ADR-006 §6, F9, F25, F26), beside ./tables.ts, which is at
// E2's size limit. SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { accounts, journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, percent, qty, radcoreTable } from '../columns.ts';
import { items, locations } from '../stock/tables.ts';
import { invoiceLines, invoices } from './tables.ts';

/**
 * A credit note against one posted invoice (ADR-007 §6): value only (a discount or price correction, no stock), or goods
 * back into a place at the value they went out at. Every note is approved by someone else (credit_notes:approve, with
 * the second factor); approving posts it. Posting writes its totals, rounded to the rupee as the invoice's are, and
 * whether it's past section 34's limit (`late`: its tax then goes to GST Borne on Late Credit Notes, F25). A counter
 * refund (F26) is drafted with the note, its amount and the cash or bank account, and paid as the note posts.
 */
export const creditNotes = radcoreTable('credit_notes', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  kind: text().notNull(),
  invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: 'restrict' }),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  // Its invoice's owner, for record scope (ADR-007 §7), whoever drafts it.
  owner: text().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  // Where goods back go; none for a value-only note.
  locationId: uuid().references(() => locations.id, { onDelete: 'restrict' }),
  reason: boundedText({ max: 500 }).notNull(),
  refundAmount: money(),
  refundAccountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
  late: boolean().notNull().default(false),
  taxable: money().notNull().default('0'),
  cgst: money().notNull().default('0'),
  sgst: money().notNull().default('0'),
  igst: money().notNull().default('0'),
  roundOff: money({ signed: true }).notNull().default('0'),
  total: money().notNull().default('0'),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_credit_notes_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_credit_notes_kind', sql`${t.kind} in ('value', 'goods') and (${t.kind} = 'goods') = (${t.locationId} is not null)`),
  // Posted, it has its number, and its entry unless nothing it posts has value (as an invoice's).
  check('ck_credit_notes_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_credit_notes_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  check('ck_credit_notes_refund', sql`(${t.refundAmount} is null) = (${t.refundAccountId} is null) and coalesce(${t.refundAmount}, 1) > 0`),
  // The header's own identity (ADR-005 §2), as an invoice's; the lines against it are checked at commit (RA006).
  check('ck_credit_notes_identity', sql`${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.roundOff}
    and abs(${t.roundOff}) < 1 and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  index('ix_credit_notes_invoice').on(t.invoiceId),
  index('ix_credit_notes_party_date').on(t.partyId, t.businessDate),
  index('ix_credit_notes_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_credit_notes_owner').on(t.owner),
  index('ix_credit_notes_location').on(t.locationId),
  index('ix_credit_notes_refund_account').on(t.refundAccountId),
  index('ix_credit_notes_posted_entry').on(t.postedEntryId),
  index('ix_credit_notes_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A credit note's line, against one invoice line. Goods back name a quantity and the batches and serials they come
 * back in (from those the line's delivery took); value only names the taxable value credited. Posting copies the
 * invoice line's GST rate and its source, and writes the tax and, for goods, their share of the cost the invoice line
 * moved to COGS (`cost`, 0 for value only), each against what's left of the invoice line (ADR-007 §6).
 * shortcut: no cess columns while cess is held at 0 (CA-50); lib-gst's cess rates add them.
 */
export const creditNoteLines = radcoreTable('credit_note_lines', {
  id: id(),
  creditNoteId: uuid().notNull().references(() => creditNotes.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  invoiceLineId: uuid().notNull().references(() => invoiceLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }),
  picks: json(),
  taxable: money(),
  gstRate: percent(),
  gstRateSource: boundedText({ max: 200 }),
  cgst: money(),
  sgst: money(),
  igst: money(),
  lineTotal: money(),
  cost: money(),
}, (t) => [
  uniqueIndex('ux_credit_note_lines_line').on(t.creditNoteId, t.lineNo),
  index('ix_credit_note_lines_invoice_line').on(t.invoiceLineId),
  index('ix_credit_note_lines_item').on(t.itemId),
  // Goods back carry a quantity and picks; value only, its taxable value from the draft on.
  check('ck_credit_note_lines_kind', sql`(${t.qty} is null) = (${t.picks} is null) and (${t.qty} is not null or ${t.taxable} is not null)`),
  // Posting writes every figure at once; a draft line has none but a value line's taxable.
  check('ck_credit_note_lines_posted', sql`num_nulls(${t.gstRate}, ${t.gstRateSource}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.lineTotal}, ${t.cost}) in (0, 7)
    and (${t.lineTotal} is null or ${t.taxable} is not null)`),
  check('ck_credit_note_lines_identity', sql`${t.lineTotal} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst}
    and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
]);
