// Invoices (M3-09, RAD-113; ADR-007 §1–§4, §7, §9; ADR-006 §6, F6, F7), re-exported by ../contract.ts. An invoice bills
// a party's posted deliveries' lines, all or part, at their order lines' rates unless the person sets another. Posting
// freezes the issuer and buyer, copies each line's GST rate and source, posts Debtors, Sales, Output GST, the round-off
// and the goods' cost from GDNI to COGS, and draws its number (INV) last. Like every contract file it imports only zod,
// lib-common and other libraries' contract entries (D5).
import {
  cost, dateString, defineContract, idString, listInput, listOf, moneyString, percentString, pii, piiRecord, quantityString, reason,
  unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const stateCode = () => z.string().regex(/^[0-9]{2}$/, 'A two-digit state code');
const text = (max: number) => z.string().trim().min(1).max(max);

/** Where the goods go, when it isn't the buyer's address (Rule 46). Its state is the place of supply (CA-08). */
const shipTo = z.object({ name: text(200), address: text(400), stateCode: stateCode() }).nullable();
/** A line bills some of a posted delivery line; its rate and discount are the order line's unless set here. */
const lineIn = z.object({ deliveryLineId: idString(), qty: quantityString(), rate: unitPriceString().optional(),
  discountPercent: percentString({ max: '100' }).optional() });
const invoiceIn = z.object({ partyId: idString(), businessDate: dateString(), notes: z.string().trim().max(500).nullable(), shipTo,
  lines: z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines') });

const money = () => moneyString();
const posted = {
  hsn: z.string().nullable(), gstRate: z.string().nullable(), gstRateSource: z.string().nullable(), taxable: money().nullable(),
  cgst: money().nullable(), sgst: money().nullable(), igst: money().nullable(), cessAdValorem: money(),
  cessPerUnitAmount: money(), lineTotal: money().nullable(), cost: cost(money().nullable()), deliveryTaxable: money().nullable(),
  deliveryGst: money().nullable(),
};
// A line with its item's SKU and name (RAD-125's screens), and the worst condition of the units it bills when they
// aren't all new: read as they stand while a draft, carried once posted (the architect on RAD-112).
const line = z.object({ id: idString(), lineNo: z.number().int().positive(), deliveryLineId: idString(), itemId: idString(),
  sku: z.string(), name: z.string(), qty: quantityString(), rate: unitPriceString(), discountPercent: z.string(), ...posted,
  unitCondition: z.enum(['demo', 'used', 'damaged']).nullable(),
  // For a credit note's goods back (ui-2 on #298): the batches the line's goods left in, as delivered, and its units still
  // out with the batch each left in; goods back name batches and serials from these.
  goods: z.object({ batches: z.array(z.object({ batchId: idString().nullable(), batchNo: z.string().nullable(), qty: quantityString() })),
    units: z.array(z.object({ serialNo: z.string(), batchId: idString().nullable() })) }) });
const header = z.object({
  id: idString(), number: z.string().nullable(), partyId: idString(), partyName: z.string(), businessDate: dateString(), status,
  notes: z.string().nullable(), total: money(),
});
// The buyer's and ship-to addresses are personal data, as on the party (RAD-40): shown to whoever sees a party's contact
// details (parties:contact) or holds pii:read, and a look at them is logged against the invoice.
const invoice = piiRecord('invoices', header.extend({
  shipTo: z.object({ name: z.string(), address: pii(z.string()), stateCode: z.string() }).nullable(),
  issuer: z.object({ legalName: z.string(), gstin: z.string(), addressLine1: z.string(), addressLine2: z.string().nullable(),
    city: z.string(), pincode: z.string(), stateCode: z.string() }).nullable(),
  buyer: z.object({ name: z.string(), gstin: z.string().nullable(), addressLine1: pii(z.string().nullable()),
    addressLine2: pii(z.string().nullable()), city: pii(z.string().nullable()), pincode: pii(z.string().nullable()),
    stateCode: z.string() }).nullable(),
  placeOfSupply: z.string().nullable(),
  taxable: money(), cgst: money(), sgst: money(), igst: money(), cess: money(), roundOff: z.string(),
  lines: z.array(line),
}), { seenWith: 'parties:contact' });

// The refusals a draft shares: its date (§4), its lines, its party and its status.
const DRAFT_ERRORS = ['date_in_future', 'date_before_source', 'invoice_too_late', 'wrong_status', 'not_on_source', 'over_quantity',
  'quantity_too_precise', 'unknown_party', 'not_a_customer', 'other_party'] as const;
const POST_ERRORS = [...DRAFT_ERRORS, 'version_changed', 'year_not_open', 'period_locked', 'month_filed', 'account_inactive', 'no_gst_rate',
  'company_profile_incomplete', 'buyer_details_required', 'needs_override', 'series_full'] as const;

/** Invoices, newest first, a page at a time. */
export const listInvoices = defineContract({
  method: 'GET', path: '/sales/invoices', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: status.optional(), partyId: idString().optional() })),
  output: listOf(header),
});
/** One invoice, with its frozen issuer and buyer and its lines. */
export const getInvoice = defineContract({
  method: 'GET', path: '/sales/invoices/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: invoice,
});
/** A new draft invoice of a party's posted deliveries' lines. */
export const createInvoice = defineContract({
  method: 'POST', path: '/sales/invoices', auth: 'session', perm: 'invoices:write', tx: write,
  input: invoiceIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/** A draft invoice, rewritten whole. */
export const updateInvoice = defineContract({
  method: 'PUT', path: '/sales/invoices/:id', auth: 'session', perm: 'invoices:write', tx: write,
  input: invoiceIn.extend({ id: idString() }), output: z.object({}), errors: [...DRAFT_ERRORS],
});
/** A draft invoice, thrown away: it never had a number. */
export const deleteInvoice = defineContract({
  method: 'DELETE', path: '/sales/invoices/:id', auth: 'session', perm: 'invoices:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Posts a draft (F6): the party's credit is checked again, and the price of any line not at its order's (M3-07); the
 * issuer and buyer are frozen, the GST worked out at the rates in force, and its number drawn last. */
export const postInvoice = defineContract({
  method: 'POST', path: '/sales/invoices/:id/post', auth: 'session', perm: 'invoices:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ number: z.string(), total: money() }), errors: [...POST_ERRORS],
});
/** Asks for an override of a draft invoice's checks: someone holding sales:override approves it (RAD-38). */
export const requestInvoiceOverride = defineContract({
  method: 'POST', path: '/sales/invoices/:id/override', auth: 'session', perm: 'invoices:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }), errors: ['wrong_status', 'no_gst_rate'],
});
/** The invoice overrides' approval routes (RAD-38). */
export const invoiceOverrideApproval = approvalContracts('sales-invoice-override', 'sales:override');
/** Cancels a posted invoice (ADR-007 §6, F10): its entry mirrored on the cancellation's day, the deliveries it billed
 * open again. Refused while payments or credits are applied to it (RC-126: receipts are never touched), or a credit
 * note stands against it. */
export const cancelInvoice = defineContract({
  method: 'POST', path: '/sales/invoices/:id/cancel', auth: 'session', perm: 'invoices:cancel', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'date_in_future', 'date_before_source', 'period_locked', 'month_filed', 'year_not_open', 'account_inactive', 'still_applied',
    'credit_note_stands'],
  dbErrors: { 'RA006:document_still_applied': { code: 'still_applied', message: 'Payments or credits are still applied to this invoice: reverse them first' } },
});
