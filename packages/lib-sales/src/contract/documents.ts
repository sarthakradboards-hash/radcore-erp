// Quotes and orders (M3-08, RAD-112; ADR-007 §1, §3, §4), re-exported by ../contract.ts. They post nothing: each moves
// through its statuses by its own routes, and draws its number when it's sent or confirmed. Dates are bounded (RC-111):
// not after today, and an order not before its quote. Like every contract file it imports only zod, lib-common and
// other libraries' contract entries (D5).
import {
  dateString, defineContract, idString, listInput, listOf, percentString, quantityString, reason, SALES_ORDER_STATUSES,
  SALES_QUOTE_STATUSES, unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** A line as sent: an item, how many, at what rate per unit before GST, less a discount. */
const lineIn = z.object({
  itemId: idString(), qty: quantityString(), rate: unitPriceString(), discountPercent: percentString({ max: '100' }),
});
const lineOut = lineIn.extend({ id: idString(), lineNo: z.number().int().positive() });
const lines = () => z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines');
const notes = () => z.string().trim().max(500).nullable();

// The refusals a quote's or order's writes share: the date's bounds (§4), its party and items, and its status.
const DOCUMENT_ERRORS = ['date_in_future', 'date_before_source', 'unknown_party', 'not_a_customer', 'unknown_item',
  'quantity_too_precise', 'wrong_status'] as const;

const quote = z.object({
  id: idString(), number: z.string().nullable(), partyId: idString(), partyName: z.string(), businessDate: dateString(),
  validUntil: dateString().nullable(), status: z.enum(SALES_QUOTE_STATUSES), notes: z.string().nullable(), lines: z.array(lineOut),
});
const quoteIn = z.object({ partyId: idString(), businessDate: dateString(), validUntil: dateString().nullable(), notes: notes(), lines: lines() });
const quoteRow = quote.omit({ lines: true });

/** Quotes, newest first, a page at a time. */
export const listQuotes = defineContract({
  method: 'GET', path: '/sales/quotes', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: z.enum(SALES_QUOTE_STATUSES).optional(), partyId: idString().optional() })),
  output: listOf(quoteRow),
});
/** One quote with its lines. */
export const getQuote = defineContract({
  method: 'GET', path: '/sales/quotes/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: quote,
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
  errors: ['wrong_status', 'date_in_future', 'year_not_open', 'period_locked'],
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
  closeReason: z.string().nullable(), lines: z.array(lineOut),
});
const orderIn = z.object({ partyId: idString(), businessDate: dateString(), notes: notes(), lines: lines() });
const orderRow = order.omit({ lines: true });

/** Orders, newest first, a page at a time. */
export const listOrders = defineContract({
  method: 'GET', path: '/sales/orders', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: z.enum(SALES_ORDER_STATUSES).optional(), partyId: idString().optional() })),
  output: listOf(orderRow),
});
/** One order with its lines. */
export const getOrder = defineContract({
  method: 'GET', path: '/sales/orders/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: order,
});
/** A new draft order. */
export const createOrder = defineContract({
  method: 'POST', path: '/sales/orders', auth: 'session', perm: 'sales:write', tx: write,
  input: orderIn, output: z.object({ id: idString() }), errors: [...DOCUMENT_ERRORS],
});
/** A draft order, rewritten whole; a confirmed one's lines too, through the checks again (§1). */
export const updateOrder = defineContract({
  method: 'PUT', path: '/sales/orders/:id', auth: 'session', perm: 'sales:write', tx: write,
  input: orderIn.extend({ id: idString() }), output: z.object({}), errors: [...DOCUMENT_ERRORS, 'needs_override', 'no_gst_rate', 'order_delivered'],
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
  errors: ['wrong_status', 'date_in_future', 'year_not_open', 'period_locked', 'needs_override', 'no_gst_rate', 'version_changed'],
});
/** Asks for an override of a draft order's issues: someone holding sales:override approves it (RAD-38). */
export const requestOrderOverride = defineContract({
  method: 'POST', path: '/sales/orders/:id/override', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }), errors: ['wrong_status', 'no_gst_rate'],
});
/** The overrides' approval routes (RAD-38): the pending list, one request, and the decision. */
export const orderOverrideApproval = approvalContracts('sales-order-override', 'sales:override');
/** Closes a confirmed order. With lines undelivered it's closed short, and needs a reason (RC-125). */
export const closeOrder = defineContract({
  method: 'POST', path: '/sales/orders/:id/close', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), reason: reason().optional() }), output: z.object({ short: z.boolean() }),
  errors: ['wrong_status', 'reason_required'],
});
/** Cancels a confirmed order nothing has been delivered on, with a reason. */
export const cancelOrder = defineContract({
  method: 'POST', path: '/sales/orders/:id/cancel', auth: 'session', perm: 'sales:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({}), errors: ['wrong_status', 'order_delivered'],
});
