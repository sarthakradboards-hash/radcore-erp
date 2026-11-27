// lib-accounts' TDS (M5-10, RAD-158; ADR-009 §4): the sections and their rates by date, like GST's (M2-12). Beside
// ./tables.ts, one file per document family (ADR-009 §10). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { boolean, check, date, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, money, percent, radcoreTable } from '../columns.ts';

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
