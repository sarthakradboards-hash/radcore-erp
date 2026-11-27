// lib-gst's tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { boolean, check, date, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { boundedText, id, percent, radcoreTable } from '../columns.ts';

/**
 * GST rates by date (M2-12, RAD-91; RC-115): one row per HSN code and the date its rate took effect, from the official
 * notifications, each row naming its source. The rate is the whole GST (IGST; CGST and SGST are half each). A code is 2,
 * 4, 6 or 8 digits, kept as text so a leading zero stays. lib-gst's gstRateFor picks, for an item's HSN on a date, the
 * row in force with the newest start, a longer code breaking a tie on the same start. Never deleted: a later rate
 * supersedes, and a wrong row is corrected in place, audited with its reason.
 */
export const gstRates = radcoreTable('gst_rates', {
  id: id(),
  hsn: text().notNull(),
  effectiveFrom: date({ mode: 'string' }).notNull(),
  rate: percent().notNull(),
  source: boundedText({ max: 200 }).notNull(),
  note: boundedText({ max: 500 }),
}, (t) => [
  uniqueIndex('ux_gst_rates_hsn_from').on(t.hsn, t.effectiveFrom),
  check('ck_gst_rates_hsn', sql`${t.hsn} ~ '^[0-9]{2}([0-9]{2}){0,3}$'`),
]);

/**
 * Reverse-charge rules by date (M5-03, RAD-153; ADR-010 §4; RC-057, CA-04, CA-06): a service's SAC prefix (or a notified
 * good's HSN prefix, section 9(4)) and the supplier it applies to, in force from a date. A purchase line whose code
 * starts with the prefix, from such a supplier, on or after that date, is reverse charge: we owe its tax, not the
 * supplier. Each row names its source and whether the CA has confirmed it (D-08). Never deleted: corrected in place
 * with a reason, under gst:write.
 */
export const rcmRules = radcoreTable('rcm_rules', {
  id: id(),
  prefix: text().notNull(),
  // Which suppliers it applies to: those with no GSTIN, any, or any but a company (a body corporate).
  supplier: text().notNull(),
  effectiveFrom: date({ mode: 'string' }).notNull(),
  source: boundedText({ max: 200 }).notNull(),
  note: boundedText({ max: 500 }),
  confirmed: boolean().notNull().default(false),
}, (t) => [
  uniqueIndex('ux_rcm_rules_prefix_supplier_from').on(t.prefix, t.supplier, t.effectiveFrom),
  check('ck_rcm_rules_prefix', sql`${t.prefix} ~ '^[0-9]{2,8}$'`),
  check('ck_rcm_rules_supplier', sql`${t.supplier} in ('unregistered', 'any', 'not_body_corporate')`),
]);
