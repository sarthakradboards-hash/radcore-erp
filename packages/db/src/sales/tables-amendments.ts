// lib-sales's GSTIN amendments to filed invoices (M5-04, RAD-154; ADR-010 §5), beside ./tables.ts, which is at E2's
// size limit. SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { check, date, index, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';
import { invoices } from './tables.ts';

/**
 * A filed invoice's buyer GSTIN, corrected (ADR-010 §5): the GSTIN it had (its own, or the last amendment's) and the new
 * one, of the same state, on the day it was made, which is the month GSTR-1 reports it in (Table 9A). The invoice keeps
 * its frozen fields. Never changed or deleted: a wrong amendment is amended again. Who made it is created_by.
 */
export const invoiceAmendments = radcoreTable('invoice_amendments', {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  oldGstin: boundedText({ max: 15 }).notNull(),
  newGstin: boundedText({ max: 15 }).notNull(),
  reason: boundedText({ max: 500 }).notNull(),
}, (t) => [
  index('ix_invoice_amendments_invoice').on(t.invoiceId, t.createdAt),
  index('ix_invoice_amendments_date').on(t.businessDate),
  check('ck_invoice_amendments_same_state', sql`${t.newGstin} <> ${t.oldGstin} and left(${t.newGstin}, 2) = left(${t.oldGstin}, 2)`),
]);
