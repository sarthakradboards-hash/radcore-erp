// lib-accounts' tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { check, smallint, text } from 'drizzle-orm/pg-core';
import { boundedText, radcoreTable } from '../columns.ts';

/**
 * The company (M2-02, RAD-88; D-02 option A): RadCore keeps the books of one legal entity. The table holds one row at
 * most, its id fixed at 1, so a second company is refused by the primary key itself, not by a hidden form (RC-010).
 * Every field an invoice prints is required, and the state is the GSTIN's own first two characters, never a default
 * (RC-112). Until the row exists, nothing is invoiced (lib-accounts' companyForInvoice).
 */
export const company = radcoreTable('company', {
  id: smallint().primaryKey().default(1),
  legalName: boundedText({ max: 200 }).notNull(),
  gstin: text().notNull(),
  stateCode: text().notNull().generatedAlwaysAs(sql`left(gstin, 2)`),
  addressLine1: boundedText({ max: 200 }).notNull(),
  addressLine2: boundedText({ max: 200 }),
  city: boundedText({ max: 100 }).notNull(),
  pincode: text().notNull(),
}, (t) => [
  check('ck_company_one', sql`${t.id} = 1`),
  check('ck_company_gstin', sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check('ck_company_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
]);
