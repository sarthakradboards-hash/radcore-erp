// lib-gst's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import { dateString, dec, defineContract, idString, listInput, listOf, percentString, reason } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** An HSN code as a rate row holds it: 2, 4, 6 or 8 digits (a chapter, heading, sub-heading or tariff item). */
const rateHsn = () => z.string().regex(/^[0-9]{2}([0-9]{2}){0,3}$/, 'An HSN code is 2, 4, 6 or 8 digits');
/** An item's HSN code: 4, 6 or 8 digits, as an item holds it. */
const itemHsn = () => z.string().regex(/^[0-9]{4}([0-9]{2}){0,2}$/, 'An HSN code is 4, 6 or 8 digits');

/** What a supply is (ADR-010 §2, RAD-154): taxable, or at 0% nil-rated, exempt or outside GST (GSTR-1's Table 8). */
const SUPPLY_KINDS = ['taxable', 'nil', 'exempt', 'non_gst'] as const;
const rateRow = z.object({
  id: idString(), hsn: z.string(), effectiveFrom: dateString(), rate: percentString(), source: z.string(), note: z.string().nullable(),
  supplyKind: z.enum(SUPPLY_KINDS),
});

/** GET /gst/rates (gst:read): every rate row by HSN, then start date, a page at a time; `hsn` narrows to codes that
 * start with it. */
export const listGstRates = defineContract({
  method: 'GET', path: '/gst/rates', auth: 'session', perm: 'gst:read', tx: read,
  input: listInput(z.object({ hsn: z.string().regex(/^[0-9]{1,8}$/, 'Digits only').optional() })),
  output: listOf(rateRow),
});

/** GET /gst/rates/in-force (gst:read): the rate an item with this HSN takes on this date (RC-115): the row in force with
 * the newest start, a longer code breaking a tie. no_gst_rate: no row covers it, which is never read as 0%. */
export const getGstRateInForce = defineContract({
  method: 'GET', path: '/gst/rates/in-force', auth: 'session', perm: 'gst:read', tx: read,
  input: z.object({ hsn: itemHsn(), on: dateString() }), output: rateRow, errors: ['no_gst_rate'],
});

/** PUT /gst/rates (gst:write): the rate for an HSN code from a date, with the notification it comes from. The same
 * code and date again corrects that row (audited, with the person's reason); a new date adds a row. `supplyKind`: taxable
 * above 0%, else nil-rated unless it says exempt or non-GST (rate_supply_kind when they don't agree). */
export const setGstRate = defineContract({
  method: 'PUT', path: '/gst/rates', auth: 'session', perm: 'gst:write', tx: write,
  input: z.object({
    hsn: rateHsn(), effectiveFrom: dateString(), rate: percentString(),
    source: z.string().trim().min(1, 'Name the notification this rate comes from').max(200),
    note: z.string().trim().max(500).nullable(), supplyKind: z.enum(SUPPLY_KINDS).optional(), reason: reason(),
  }).refine((r) => r.supplyKind === undefined || (r.supplyKind === 'taxable') === dec(r.rate).gt(0),
    { path: ['supplyKind'], message: 'A rate above 0% is taxable; a 0% rate is nil-rated, exempt or non-GST' }),
  output: z.object({ id: idString() }),
});
