// lib-accounts' tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { boundedText, id, money, radcoreTable, trigramIndex } from '../columns.ts';

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

/**
 * Parties (M2-11, RAD-90): everyone RadCore sells to or buys from, as one or more kinds (a dealer who also supplies is
 * one party). A registered party's GSTIN is unique, its PAN is the GSTIN's own, and its state is the GSTIN's; an
 * unregistered party still has a state, for the place of supply (ADR-006 §6). A composition dealer is registered.
 * Phone, email and address are personal data: answered as pii(), and redacted in the audit trail (RAD-40). Credit
 * terms are set only through their own route, with parties:manage. A party is switched off, never deleted (ADR-005 §3).
 */
export const parties = radcoreTable('parties', {
  id: id(),
  name: boundedText({ max: 200 }).notNull(),
  // Its kinds, one or more: a dealer who also supplies is one party.
  customer: boolean().notNull().default(false),
  dealer: boolean().notNull().default(false),
  franchisee: boolean().notNull().default(false),
  supplier: boolean().notNull().default(false),
  gstin: text(),
  pan: text(),
  composition: boolean().notNull().default(false),
  stateCode: text().notNull(),
  phone: text(),
  email: boundedText({ max: 254 }),
  addressLine1: boundedText({ max: 200 }),
  addressLine2: boundedText({ max: 200 }),
  city: boundedText({ max: 100 }),
  pincode: text(),
  creditDays: smallint(),
  creditLimit: money(),
  active: boolean().notNull().default(true),
}, (t) => [
  uniqueIndex('ux_parties_gstin').on(t.gstin),
  trigramIndex('ix_parties_name_trgm', t.name),
  check('ck_parties_kinds', sql`${t.customer} or ${t.dealer} or ${t.franchisee} or ${t.supplier}`),
  check('ck_parties_gstin', sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check('ck_parties_pan', sql`${t.pan} ~ '^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$'`),
  check('ck_parties_pan_in_gstin', sql`${t.gstin} is null or ${t.pan} is null or substr(${t.gstin}, 3, 10) = ${t.pan}`),
  check('ck_parties_state', sql`${t.stateCode} ~ '^[0-9]{2}$' and (${t.gstin} is null or left(${t.gstin}, 2) = ${t.stateCode})`),
  check('ck_parties_composition', sql`not ${t.composition} or ${t.gstin} is not null`),
  check('ck_parties_phone', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$'`),
  check('ck_parties_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
  check('ck_parties_credit_days', sql`${t.creditDays} between 0 and 365`),
]);
