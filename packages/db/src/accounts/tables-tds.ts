// lib-accounts' TDS (M5-10, RAD-158; ADR-009 §4): the sections and their rates by date, like GST's (M2-12). Beside
// ./tables.ts, one file per document family (ADR-009 §10). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, primaryKey, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { boundedText, createdMoment, id, money, percent, radcoreTable } from '../columns.ts';
import { accounts, journalEntries, parties } from './tables.ts';

/** A TDS section (CA-18): its code, its name, the section of the Income-tax Act 2025 and the 1961 section it replaces,
 * and the payee it's for: `individual` (a PAN's fourth letter P or H), `other`, or `any`. Seeded; never deleted. */
export const tdsSections = radcoreTable('tds_sections', {
  id: id(),
  code: text().notNull(),
  name: boundedText({ max: 120 }).notNull(),
  act2025: boundedText({ max: 40 }).notNull(),
  act1961: boundedText({ max: 40 }).notNull(),
  payee: text().notNull(),
}, (t) => [
  check('ck_tds_sections_code', sql`${t.code} ~ '^[0-9A-Z][0-9A-Z-]{1,19}$'`),
  check('ck_tds_sections_payee', sql`${t.payee} in ('individual', 'other', 'any')`),
  uniqueIndex('ux_tds_sections_code').on(t.code),
]);

/** A section's rate from a date (ADR-009 §4): the rate and the no-PAN rate (CA-20), the single and yearly limits, and
 * whether crossing the yearly limit taxes the year's `whole` base or only its `excess`. A later row supersedes; a wrong
 * one is corrected in place, audited with its reason; never deleted. Unconfirmed until the CA signs it (D-08). */
export const tdsRates = radcoreTable('tds_rates', {
  id: id(),
  sectionId: uuid().notNull().references(() => tdsSections.id, { onDelete: 'restrict' }),
  effectiveFrom: date({ mode: 'string' }).notNull(),
  rate: percent().notNull(),
  rateNoPan: percent().notNull(),
  singleLimit: money(),
  yearlyLimit: money(),
  limitKind: text().notNull().default('whole'),
  source: boundedText({ max: 200 }).notNull(),
  note: boundedText({ max: 500 }),
  confirmed: boolean().notNull().default(false),
}, (t) => [
  check('ck_tds_rates_limit_kind', sql`${t.limitKind} in ('whole', 'excess')`),
  // An excess row taxes only the year's base over its yearly limit, so it has one.
  check('ck_tds_rates_excess', sql`${t.limitKind} = 'whole' or ${t.yearlyLimit} is not null`),
  check('ck_tds_rates_no_pan', sql`${t.rateNoPan} >= ${t.rate}`),
  uniqueIndex('ux_tds_rates_section_from').on(t.sectionId, t.effectiveFrom),
]);

/** A party's TDS terms (ADR-009 §4; RAD-158): its default section, which a bill or expense line takes unless it names
 * another, and whether its PAN is inoperative, so it's deducted at the no-PAN rate (CA-20). Kept beside the party, not on
 * it, so the parties table and these don't import each other. */
export const partyTds = radcoreTable('party_tds', {
  partyId: uuid().primaryKey().references(() => parties.id, { onDelete: 'restrict' }),
  defaultSectionId: uuid().references(() => tdsSections.id, { onDelete: 'restrict' }),
  panInoperative: boolean().notNull().default(false),
}, (t) => [index('ix_party_tds_section').on(t.defaultSectionId)]);

/**
 * Every booking line with a TDS section (ADR-009 §4), written with the posting, even one that deducts nothing: its
 * document and line, payee, section, financial year and month, the base, the rate it took with the payee's PAN as it
 * stood, whether that was the no-PAN rate, and the amount. A cancel writes a reversal (base and amount negated, naming the
 * row it reverses), so the year's sums are one indexed read on (party, section, year).
 */
export const tdsDeductions = radcoreTable('tds_deductions', {
  id: id(), createdAt: createdMoment(),
  sourceTable: text().notNull(),
  sourceId: uuid().notNull(),
  sourceLineId: uuid().notNull(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  sectionId: uuid().notNull().references(() => tdsSections.id, { onDelete: 'restrict' }),
  financialYear: date({ mode: 'string' }).notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  base: money({ signed: true }).notNull(),
  rate: percent().notNull(),
  noPanRate: boolean().notNull(),
  amount: money({ signed: true }).notNull(),
  reversesId: uuid().references((): AnyPgColumn => tdsDeductions.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_tds_deductions_source_table', sql`${t.sourceTable} ~ '^[a-z][a-z0-9_]*$'`),
  check('ck_tds_deductions_year', sql`extract(month from ${t.financialYear}) = 4 and extract(day from ${t.financialYear}) = 1`),
  // A booking deducts zero or more; only its reversal is negative.
  check('ck_tds_deductions_sign', sql`(${t.reversesId} is null) = (${t.base} >= 0 and ${t.amount} >= 0)`),
  index('ix_tds_deductions_year').on(t.partyId, t.sectionId, t.financialYear),
  index('ix_tds_deductions_source').on(t.sourceTable, t.sourceId),
  index('ix_tds_deductions_section').on(t.sectionId),
  // A row is reversed once.
  uniqueIndex('ux_tds_deductions_reverses').on(t.reversesId),
]);

/** A TDS deposit (ADR-009 §4, F18): a challan paid from a bank account on its date, paying the deductions it names, each
 * in full. Posted at once (Dr TDS Payable, Cr the bank); its number from `accounts.tds_deposit`. Its correction waits on
 * CA-22 (M7), so it's never cancelled here. */
export const tdsDeposits = radcoreTable('tds_deposits', {
  id: id(), createdAt: createdMoment(),
  number: text().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  challanNumber: boundedText({ max: 20 }).notNull(),
  bsrCode: text().notNull(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amount: money().notNull(),
  // Set by its posting, in the same save, once the deposit has an id for the entry to name.
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_tds_deposits_bsr_code', sql`${t.bsrCode} ~ '^[0-9]{7}$'`),
  check('ck_tds_deposits_challan', sql`btrim(${t.challanNumber}) <> ''`),
  uniqueIndex('ux_tds_deposits_number').on(t.number),
  index('ix_tds_deposits_account').on(t.accountId),
  index('ix_tds_deposits_entry').on(t.postedEntryId),
  index('ix_tds_deposits_page').on(t.businessDate, t.createdAt, t.id),
]);

/** The deductions a deposit pays. A deduction is deposited once (the unique key), and a reversal never. */
export const tdsDepositLines = radcoreTable('tds_deposit_lines', {
  depositId: uuid().notNull().references(() => tdsDeposits.id, { onDelete: 'restrict' }),
  deductionId: uuid().notNull().references(() => tdsDeductions.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ name: 'pk_tds_deposit_lines', columns: [t.depositId, t.deductionId] }),
  uniqueIndex('ux_tds_deposit_lines_deduction').on(t.deductionId),
]);
