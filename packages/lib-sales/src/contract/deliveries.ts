// Deliveries and delivery returns (M3-08, RAD-112; ADR-007 §1, §3, §4; ADR-006 §4–§6, F5), re-exported by
// ../contract.ts. A delivery takes an order's goods out of a place, the person naming the batches and serials; a
// return takes some back before they're invoiced, into the batches they left with. Both post (stock, units, the
// journal) and draw their numbers (DC, DR) last. Like every contract file it imports only zod, lib-common and other
// libraries' contract entries (D5).
import { cost, dateString, defineContract, idString, listInput, listOf, moneyString, quantityString } from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);

/** What the person picked for a line: its batches (null for "batch unknown", a negative-stock delivery's part beyond
 * what's on hand) and, for a serialised item, a serial number per unit. */
const picks = {
  batches: z.array(z.object({ batchId: idString().nullable(), qty: quantityString() })).min(1, 'Pick the batches').max(50),
  serials: z.array(z.string().trim().min(1).max(60)).max(1000),
};
/** What posting wrote: the cost it went out at (cost(), RC-164) and what it sold for, before and with GST. */
const posted = { value: cost(moneyString().nullable()), taxable: moneyString().nullable(), gst: moneyString().nullable() };
const notes = () => z.string().trim().max(500).nullable();
const lines = <T extends z.ZodType>(line: T) => z.array(line).min(1, 'Add at least one line').max(200, 'At most 200 lines');

// The refusals a delivery's or return's draft shares: its date (§4), its lines, and its status.
const DRAFT_ERRORS = ['date_in_future', 'date_before_source', 'wrong_status', 'not_on_source', 'over_quantity',
  'quantity_too_precise', 'unknown_location', 'location_inactive', 'place_not_sellable'] as const;
const POST_ERRORS = [...DRAFT_ERRORS, 'version_changed', 'year_not_open', 'period_locked', 'account_inactive', 'no_gst_rate', 'not_enough_stock', 'qty_not_positive', 'batches_mismatch',
  'units_mismatch', 'serial_twice', 'not_serialised'] as const;

const deliveryLineIn = z.object({ orderLineId: idString(), qty: quantityString(), ...picks });
const delivery = z.object({
  id: idString(), number: z.string().nullable(), orderId: idString(), partyId: idString(), partyName: z.string(),
  locationId: idString(), businessDate: dateString(), status, notes: z.string().nullable(),
  lines: z.array(deliveryLineIn.extend({ id: idString(), lineNo: z.number().int().positive(), itemId: idString(), ...posted })),
});
const deliveryIn = z.object({ orderId: idString(), locationId: idString(), businessDate: dateString(), notes: notes(),
  lines: lines(deliveryLineIn) });

/** Deliveries, newest first, a page at a time. */
export const listDeliveries = defineContract({
  method: 'GET', path: '/sales/deliveries', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: status.optional(), partyId: idString().optional(), orderId: idString().optional() })),
  output: listOf(delivery.omit({ lines: true })),
});
/** One delivery with its lines. */
export const getDelivery = defineContract({
  method: 'GET', path: '/sales/deliveries/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: delivery,
});
/** A new draft delivery against a confirmed order's lines. */
export const createDelivery = defineContract({
  method: 'POST', path: '/sales/deliveries', auth: 'session', perm: 'deliveries:write', tx: write,
  input: deliveryIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/** A draft delivery, rewritten whole. */
export const updateDelivery = defineContract({
  method: 'PUT', path: '/sales/deliveries/:id', auth: 'session', perm: 'deliveries:write', tx: write,
  input: deliveryIn.extend({ id: idString() }), output: z.object({}), errors: [...DRAFT_ERRORS],
});
/** A draft delivery, thrown away: it never had a number. */
export const deleteDelivery = defineContract({
  method: 'DELETE', path: '/sales/deliveries/:id', auth: 'session', perm: 'deliveries:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Posts a draft (F5): the party's credit is checked again (M3-07), then the goods go out at the average through Goods
 * Delivered Not Invoiced, and its number is drawn last. Over the credit check it needs an approved override. */
export const postDelivery = defineContract({
  method: 'POST', path: '/sales/deliveries/:id/post', auth: 'session', perm: 'deliveries:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ number: z.string() }), errors: [...POST_ERRORS, 'needs_override'],
});
/** Asks for an override of a draft delivery's credit check: someone holding sales:override approves it (RAD-38). */
export const requestDeliveryOverride = defineContract({
  method: 'POST', path: '/sales/deliveries/:id/override', auth: 'session', perm: 'deliveries:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }), errors: ['wrong_status', 'no_gst_rate'],
});
/** The delivery overrides' approval routes (RAD-38). */
export const deliveryOverrideApproval = approvalContracts('sales-delivery-override', 'sales:override');

/** The posted deliveries not yet fully invoiced, oldest first (ADR-007 §4): what's waiting for its invoice. */
export const listToInvoice = defineContract({
  method: 'GET', path: '/sales/deliveries/to-invoice', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ partyId: idString().optional() })),
  output: listOf(z.object({ id: idString(), number: z.string(), partyId: idString(), partyName: z.string(), businessDate: dateString(),
    toInvoice: moneyString() })),
});

const returnLineIn = z.object({ deliveryLineId: idString(), qty: quantityString(), ...picks });
const deliveryReturn = z.object({
  id: idString(), number: z.string().nullable(), deliveryId: idString(), partyId: idString(), partyName: z.string(),
  locationId: idString(), businessDate: dateString(), status, notes: z.string().nullable(),
  lines: z.array(returnLineIn.extend({ id: idString(), lineNo: z.number().int().positive(), itemId: idString(), ...posted })),
});
const returnIn = z.object({ deliveryId: idString(), locationId: idString(), businessDate: dateString(), notes: notes(),
  lines: lines(returnLineIn) });

/** Delivery returns, newest first, a page at a time. */
export const listDeliveryReturns = defineContract({
  method: 'GET', path: '/sales/delivery-returns', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: status.optional(), deliveryId: idString().optional() })),
  output: listOf(deliveryReturn.omit({ lines: true })),
});
/** One delivery return with its lines. */
export const getDeliveryReturn = defineContract({
  method: 'GET', path: '/sales/delivery-returns/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: deliveryReturn,
});
/** A new draft return of a posted delivery's lines, into the batches they left with. */
export const createDeliveryReturn = defineContract({
  method: 'POST', path: '/sales/delivery-returns', auth: 'session', perm: 'deliveries:write', tx: write,
  input: returnIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/** A draft return, rewritten whole. */
export const updateDeliveryReturn = defineContract({
  method: 'PUT', path: '/sales/delivery-returns/:id', auth: 'session', perm: 'deliveries:write', tx: write,
  input: returnIn.extend({ id: idString() }), output: z.object({}), errors: [...DRAFT_ERRORS],
});
/** A draft return, thrown away. */
export const deleteDeliveryReturn = defineContract({
  method: 'DELETE', path: '/sales/delivery-returns/:id', auth: 'session', perm: 'deliveries:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Posts a draft return (F5's variant): the goods come back at their share of what they went out at, and Goods
 * Delivered Not Invoiced releases the same; its number is drawn last. */
export const postDeliveryReturn = defineContract({
  method: 'POST', path: '/sales/delivery-returns/:id/post', auth: 'session', perm: 'deliveries:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ number: z.string() }), errors: [...POST_ERRORS],
});
