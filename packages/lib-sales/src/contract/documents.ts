// Quotes and orders (M3-08, RAD-112; ADR-007 §1, §3, §4), re-exported by ../contract.ts. They post nothing: each moves
// through its statuses by its own routes, and draws its number when it's sent or confirmed. Dates are bounded (RC-111):
// not after today, and an order not before its quote. Like every contract file it imports only zod, lib-common and
// other libraries' contract entries (D5).
import {
  dateString, defineContract, idString, listInput, listOf, moneyString, percentString, quantityString, reason, SALES_ORDER_STATUSES,
  SALES_QUOTE_STATUSES, unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** A line as sent: an item, how many, at what rate per unit before GST, less a discount. */
export const lineIn = z.object({
  itemId: idString(), qty: quantityString(), rate: unitPriceString(), discountPercent: percentString({ max: '100' }),
});
/** A line's amounts (the architect on RAD-112): its GST rate in force on the document's date and that rate's source, its
 * taxable value and tax, worked out as an invoice's. A draft's are worked out on read; a sent quote's or confirmed
 * order's are the ones stored then. While a draft's tax can't be worked out (the company's state isn't set, or an item
 * has no rate), only its taxable value is there. */
const money = () => moneyString().nullable();
const lineAmounts = z.object({ gstRate: z.string().nullable(), gstRateSource: z.string().nullable(), taxable: moneyString(), cgst: money(),
  sgst: money(), igst: money(), lineTotal: money() });
/** The document's place of supply and totals, rounded to the rupee as an invoice's, with `note` saying what's missing
 * while a draft's tax can't be worked out. */
const amounts = z.object({ placeOfSupply: z.string().nullable(), taxable: moneyString(), cgst: money(), sgst: money(), igst: money(),
  roundOff: z.string().nullable(), total: money(), note: z.string().nullable() });
// A line as answered, with its item's SKU and name, so a screen needn't look each item up (RAD-125), and its amounts.
const lineOut = lineIn.extend({ id: idString(), lineNo: z.number().int().positive(), sku: z.string(), name: z.string(),
  amounts: lineAmounts });
const lines = () => z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines');
const notes = () => z.string().trim().max(500).nullable();

// The refusals a quote's or order's writes share: the date's bounds (§4), its party and items, and its status.
const DOCUMENT_ERRORS = ['date_in_future', 'date_before_source', 'unknown_party', 'not_a_customer', 'unknown_item',
  'quantity_too_precise', 'wrong_status'] as const;

const quote = z.object({
  id: idString(), number: z.string().nullable(), partyId: idString(), partyName: z.string(), businessDate: dateString(),
  validUntil: dateString().nullable(), status: z.enum(SALES_QUOTE_STATUSES), notes: z.string().nullable(), amounts,
  lines: z.array(lineOut),
});
const quoteIn = z.object({ partyId: idString(), businessDate: dateString(), validUntil: dateString().nullable(), notes: notes(), lines: lines() });
// A list shows the total stored when a quote was sent or an order confirmed; a draft's isn't worked out for a list.
const quoteRow = quote.omit({ lines: true, amounts: true }).extend({ total: moneyString().nullable() });

/** Quotes, newest first, a page at a time. */
export const listQuotes = defineContract({
  method: 'GET', path: '/sales/quotes', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: z.enum(SALES_QUOTE_STATUSES).optional(), partyId: idString().optional() })),
  output: listOf(quoteRow),
});
/** How many quotes are in each status, within the principal's scope as the list is: a screen's count cards (ADR-001,
 * RC-176: a list has no total). A party's own when `partyId` is given. */
export const countQuotes = defineContract({
  method: 'GET', path: '/sales/quote-counts', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ partyId: idString().optional() }),
  output: z.object({ byStatus: z.record(z.enum(SALES_QUOTE_STATUSES), z.number().int().nonnegative()) }),
});
/** One quote with its lines, and the order it became (`orderId`, read through the order's quote_id; null when there's
 * none, or it's an order the principal may not open). */
export const getQuote = defineContract({
  method: 'GET', path: '/sales/quotes/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: quote.extend({ orderId: idString().nullable() }),
});
/** A new draft quote. */
export const createQuote = defineContract({
  method: 'POST', path: '/sales/quotes', auth: 'session', perm: 'sales:write', tx: write,
  input: quoteIn, output: z.object({ id: idString() }), errors: [...DOCUMENT_ERRORS],
});
/** A draft quote, rewritten whole. */
export const updateQuote = defineContract({
  method: 'PUT', path: '/sales/quotes/:id', auth: 'session', perm: 'sales:write', tx: write,
  input: quoteIn.extend({ id: idString() }), output: z.object({}), errors: [...DOCUMENT_ERRORS],
});
/** A draft quote, thrown away: it never had a number, so it leaves no gap. */
export const deleteQuote = defineContract({
  method: 'DELETE', path: '/sales/quotes/:id', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Sends a draft: its number is drawn, last (§3), and it's no longer edited. */
export const sendQuote = defineContract({
  method: 'POST', path: '/sales/quotes/:id/send', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ number: z.string() }),
  errors: ['wrong_status', 'date_in_future', 'year_not_open', 'period_locked', 'company_profile_incomplete', 'no_gst_rate'],
});
/** The party accepted a sent quote: it makes a draft order with its lines, dated `businessDate` (not before the quote). */
export const acceptQuote = defineContract({
  method: 'POST', path: '/sales/quotes/:id/accept', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString() }), output: z.object({ orderId: idString() }),
  errors: ['wrong_status', 'date_in_future', 'date_before_source'],
});
/** The party declined a sent quote, or it expired. */
export const closeQuote = defineContract({
  method: 'POST', path: '/sales/quotes/:id/close', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), outcome: z.enum(['declined', 'expired']) }), output: z.object({}), errors: ['wrong_status'],
});

const order = z.object({
  id: idString(), number: z.string().nullable(), partyId: idString(), partyName: z.string(), quoteId: idString().nullable(),
  businessDate: dateString(), status: z.enum(SALES_ORDER_STATUSES), notes: z.string().nullable(),
  closeReason: z.string().nullable(), amounts,
  // Where its override of the checks stands (auditor-3 on #278): a request waiting, one approved, or neither.
  override: z.enum(['none', 'pending', 'approved']),
  // Each line's progress (the architect on RAD-112): delivered, net of goods taken back, and invoiced on posted invoices,
  // worked out on read and never stored.
  lines: z.array(lineOut.extend({ delivered: quantityString(), invoiced: quantityString() })),
});
const orderIn = z.object({ partyId: idString(), businessDate: dateString(), notes: notes(), lines: lines() });
const orderRow = order.omit({ lines: true, amounts: true, override: true }).extend({ total: moneyString().nullable() });

/** Orders, newest first, a page at a time. `quoteId` is the orders a quote became (RAD-125's link from a quote). */
export const listOrders = defineContract({
  method: 'GET', path: '/sales/orders', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: z.enum(SALES_ORDER_STATUSES).optional(), partyId: idString().optional(), quoteId: idString().optional() })),
  output: listOf(orderRow),
});
/** How many orders are in each status, within the principal's scope as the list is: a screen's count cards. A party's
 * own when `partyId` is given. */
export const countOrders = defineContract({
  method: 'GET', path: '/sales/order-counts', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ partyId: idString().optional() }),
  output: z.object({ byStatus: z.record(z.enum(SALES_ORDER_STATUSES), z.number().int().nonnegative()) }),
});
/** One order with its lines. */
export const getOrder = defineContract({
  method: 'GET', path: '/sales/orders/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: order,
});
/** A new draft order. */
export const createOrder = defineContract({
  method: 'POST', path: '/sales/orders', auth: 'session', perm: 'sales:write', tx: write,
  input: orderIn, output: z.object({ id: idString() }), errors: [...DOCUMENT_ERRORS, 'counter_customer_only'],
});
/** A draft order, rewritten whole; a confirmed one's lines too, through the checks again (§1), refused if they'd need an
 * override (`change_over_checks`): only a draft gets one. */
export const updateOrder = defineContract({
  method: 'PUT', path: '/sales/orders/:id', auth: 'session', perm: 'sales:write', tx: write,
  input: orderIn.extend({ id: idString() }), output: z.object({}), errors: [...DOCUMENT_ERRORS, 'change_over_checks', 'no_gst_rate', 'order_delivered', 'company_profile_incomplete', 'version_changed',
    'period_locked', 'year_not_open', 'booking_live', 'counter_customer_only'],
});
/** A draft order, thrown away. */
export const deleteOrder = defineContract({
  method: 'DELETE', path: '/sales/orders/:id', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Confirms a draft after the credit and price checks (M3-07): its number is drawn, last (§3). With an issue it needs an
 * approved override (needs_override, naming each issue). */
export const confirmOrder = defineContract({
  method: 'POST', path: '/sales/orders/:id/confirm', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ number: z.string() }),
  errors: ['wrong_status', 'date_in_future', 'year_not_open', 'period_locked', 'needs_override', 'no_gst_rate', 'version_changed',
    'company_profile_incomplete'],
});
/** Asks for an override of a draft order's issues: someone holding sales:override approves it (RAD-38). */
export const requestOrderOverride = defineContract({
  method: 'POST', path: '/sales/orders/:id/override', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }),
  errors: ['wrong_status', 'no_gst_rate', 'company_profile_incomplete'],
});
/** The overrides' approval routes (RAD-38): the pending list, one request, and the decision. */
export const orderOverrideApproval = approvalContracts('sales-order-override', 'sales:override');
/** Closes a confirmed order. With lines undelivered it's closed short, and needs a reason (RC-125). */
export const closeOrder = defineContract({
  method: 'POST', path: '/sales/orders/:id/close', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), reason: reason().optional() }), output: z.object({ short: z.boolean() }),
  errors: ['wrong_status', 'reason_required', 'booking_live'],
});
/** Cancels a confirmed order nothing has been delivered on, with a reason. */
export const cancelOrder = defineContract({
  method: 'POST', path: '/sales/orders/:id/cancel', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'order_delivered', 'booking_live'],
});
