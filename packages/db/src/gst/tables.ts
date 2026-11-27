// lib-gst's tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { check, date, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
  // What the supply is (ADR-010 §2, CA-07, RAD-154): taxable, or at 0% nil-rated, exempt or outside GST, which GSTR-1
  // reports in Table 8, never as a sale at 0%. Zero-rated supplies (exports) come with D-10.
  supplyKind: text().$type<'taxable' | 'nil' | 'exempt' | 'non_gst'>().notNull().default('taxable'),
}, (t) => [
  uniqueIndex('ux_gst_rates_hsn_from').on(t.hsn, t.effectiveFrom),
  check('ck_gst_rates_hsn', sql`${t.hsn} ~ '^[0-9]{2}([0-9]{2}){0,3}$'`),
  check('ck_gst_rates_supply_kind', sql`${t.supplyKind} in ('taxable', 'nil', 'exempt', 'non_gst') and (${t.supplyKind} = 'taxable') = (${t.rate} > 0)`),
]);
