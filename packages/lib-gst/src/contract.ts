// lib-gst's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import { dateString, dec, defineContract, idString, listInput, listOf, moneyString, percentString, reason } from '@radcore/lib-common';
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

// Reverse-charge rules by date (M5-03, RAD-153; ADR-010 §4; CA-06).
const RCM_SUPPLIERS = ['unregistered', 'any', 'not_body_corporate'] as const;
const rcmRule = z.object({
  id: idString(), prefix: z.string(), supplier: z.enum(RCM_SUPPLIERS), effectiveFrom: dateString(), source: z.string(), note: z.string().nullable(),
  confirmed: z.boolean(),
});

/** GET /gst/rcm-rules (gst:read): every reverse-charge rule, by prefix, supplier and start date. A line whose SAC (or a
 * notified good's HSN) starts with a rule's prefix, from a supplier it covers, on or after its date, owes the tax
 * itself; each rule says whether the CA has confirmed it. */
export const listRcmRules = defineContract({
  method: 'GET', path: '/gst/rcm-rules', auth: 'session', perm: 'gst:read', tx: read,
  input: z.object({}), output: z.object({ items: z.array(rcmRule) }),
});

/** PUT /gst/rcm-rules (gst:write): a rule for a code prefix and supplier from a date, with its source. The same prefix,
 * supplier and date again corrects that rule (audited, with the person's reason); a rule is never deleted. */
export const setRcmRule = defineContract({
  method: 'PUT', path: '/gst/rcm-rules', auth: 'session', perm: 'gst:write', tx: write,
  input: z.object({
    prefix: z.string().regex(/^[0-9]{2,8}$/, 'A SAC or HSN prefix is 2 to 8 digits'), supplier: z.enum(RCM_SUPPLIERS), effectiveFrom: dateString(),
    source: z.string().trim().min(1, 'Name the notification this rule comes from').max(200),
    note: z.string().trim().max(500).nullable(), confirmed: z.boolean(), reason: reason(),
  }),
  output: z.object({ id: idString() }),
});

// GSTR-1 (M5-04, RAD-154; ADR-010 §3). A month's tables, built from its documents, never stored until it's filed (§1).
const signed = () => moneyString({ signed: true });
const tax = z.object({ taxable: signed(), igst: signed(), cgst: signed(), sgst: signed(), cess: signed() });
const gstDoc = z.object({ number: z.string().nullable(), date: dateString(), value: moneyString(), placeOfSupply: z.string(),
  items: z.array(tax.extend({ rate: z.string() })) });
const noteDoc = gstDoc.extend({ buyerGstin: z.string().nullable(), invoiceNumber: z.string().nullable(), invoiceDate: dateString() });

/** GET /gst/returns/gstr1 (gst:returns): GSTR-1 for a month (YYYY-MM), by ADR-010 §3's tables, from the month's posted
 * invoices and credit notes. A note past section 34's limit is in no table; a cancelled document is only in Table 13. */
export const getGstr1 = defineContract({
  method: 'GET', path: '/gst/returns/gstr1', auth: 'session', perm: 'gst:returns', tx: read,
  input: z.object({ month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'A month is YYYY-MM') }),
  output: z.object({
    month: z.string(),
    table4a: z.array(gstDoc.extend({ buyerGstin: z.string() })),
    table4c: z.array(gstDoc.extend({ buyerGstin: z.string(), ecommerceGstin: z.string() })),
    table5: z.array(gstDoc),
    table7: z.array(tax.extend({ placeOfSupply: z.string(), rate: z.string(), ecommerceGstin: z.string().nullable() })),
    table8: z.array(z.object({ supply: z.enum(['inter', 'intra']), buyer: z.enum(['registered', 'unregistered']), kind: z.string(), value: signed() })),
    table9b: z.object({ cdnr: z.array(noteDoc), cdnur: z.array(noteDoc) }),
    table11a: z.array(z.never()),
    table11b: z.array(z.never()),
    table12: z.array(tax.extend({ part: z.enum(['b2b', 'b2c']), hsn: z.string(), uqc: z.string(), rate: z.string(), qty: z.string() })),
    table13: z.array(z.object({ kind: z.enum(['invoices', 'credit_notes']), series: z.string(), from: z.string(), to: z.string(),
      count: z.number().int(), cancelled: z.number().int() })),
    table14: z.array(tax.extend({ ecommerceGstin: z.string() })),
  }),
});
