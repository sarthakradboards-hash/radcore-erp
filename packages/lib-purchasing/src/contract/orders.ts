// Purchase orders (M4-01, RAD-136; ADR-008 §1, §3, §4, §5, §13), re-exported by ../contract.ts. A PO posts nothing: it's
// a draft, then placed (numbered PO/YY-YY/NNNNN), then closed when every line is received or closed short with a reason,
// or cancelled while nothing has been received against it. Placing compares its total (with tax) with the placer's role
// limit: within it, it's placed at once; above it, it waits for someone else's approval under purchasing:approve, and
// the approval places it. Like every contract file it imports only zod, lib-common and other libraries' contract
// entries (D5).
import {
  dateString, defineContract, idString, listInput, listOf, moneyString, PURCHASE_ORDER_STATUSES, quantityString, reason, unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts, printContract } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(PURCHASE_ORDER_STATUSES);
const money = () => moneyString().nullable();
const roleKey = () => z.string().regex(/^[a-z][a-z_]{1,31}$/, 'Not a role');

/** A line as sent: an item, how many, and its rate per unit before tax (ADR-008 §5). */
const lineIn = z.object({ itemId: idString(), qty: quantityString(), rate: unitPriceString() });
/** A line's tax, worked out by lib-gst as a sale's is, from the supplier's state against ours: on read while a draft,
 * stored when placed. While it can't be worked out (our state isn't set, or the item has no rate), only its taxable
 * value is there. */
const lineAmounts = z.object({ gstRate: z.string().nullable(), gstRateSource: z.string().nullable(), taxable: moneyString(), cgst: money(),
  sgst: money(), igst: money(), lineTotal: money() });
/** The PO's place of supply and totals, rounded to the rupee, with `note` saying what's missing while a draft's tax
 * can't be worked out. */
const amounts = z.object({ placeOfSupply: z.string().nullable(), taxable: moneyString(), cgst: money(), sgst: money(), igst: money(),
  roundOff: z.string().nullable(), total: money(), note: z.string().nullable() });
/** A line as answered, with its item's SKU, name and unit, and how much of it has come in (M4-02; 0 until then). */
const lineOut = lineIn.extend({ id: idString(), lineNo: z.number().int().positive(), sku: z.string(), name: z.string(), unit: z.string(),
  received: quantityString(), amounts: lineAmounts });
const lines = () => z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines');
const header = z.object({
  id: idString(), number: z.string().nullable(), supplierId: idString(), supplierName: z.string(), businessDate: dateString(),
  expectedBy: dateString().nullable(), status, total: money(),
  /** Whether a request for its approval is waiting (ADR-008 §5): a draft placed above its placer's limit. */
  awaitingApproval: z.boolean(),
});
const order = header.extend({
  notes: z.string().nullable(), amounts, lines: z.array(lineOut),
  /** The total its approval was for, where one was needed: a change above it is refused (over_approved). */
  approvedTotal: money(),
  /** Why a person closed it with lines still to come. */
  closedReason: z.string().nullable(),
});
const orderShape = z.object({ supplierId: idString(), businessDate: dateString(), expectedBy: dateString().nullable(),
  notes: z.string().trim().max(500).nullable(), lines: lines() });
/** Its expected-by date, when given, isn't before its own (the auditor on #333). Applied to each input: a refined
 * object can't be extended. */
const expectedAfter = <T extends z.ZodType<{ businessDate: string; expectedBy: string | null }>>(s: T) =>
  s.refine((o) => o.expectedBy === null || o.expectedBy >= o.businessDate, { path: ['expectedBy'], message: 'Expected on or after the order’s date' });
const orderIn = expectedAfter(orderShape);

// What a draft's save can refuse: its dates (ADR-008 §4), its supplier and items, and its status.
const DRAFT_ERRORS = ['date_in_future', 'year_not_open', 'period_locked', 'unknown_party', 'not_a_supplier', 'unknown_item',
  'item_inactive', 'quantity_too_precise', 'wrong_status'] as const;
// What placing adds: the tax worked out and stored, the number drawn, and a check that the approved version still holds.
const PLACE_ERRORS = [...DRAFT_ERRORS, 'no_gst_rate', 'company_profile_incomplete', 'version_changed', 'series_full'] as const;
/** What placing answers: placed at once (with its number), or waiting for approval (with the request's id and the version
 * hash it was asked for), when its total is above the placer's limit. */
const placed = z.object({ status: z.enum(['placed', 'pending_approval']), number: z.string().nullable(), approvalId: idString().nullable(),
  versionHash: z.string().nullable() });

/** Purchase orders, newest first, a page at a time; the principal's own where that's their scope. */
export const listPurchaseOrders = defineContract({
  method: 'GET', path: '/purchasing/orders', auth: 'session', perm: 'purchasing:read', tx: read,
  input: listInput(z.object({ status: status.optional(), supplierId: idString().optional() })),
  output: listOf(header),
});
/** One purchase order, with its lines and amounts. */
export const getPurchaseOrder = defineContract({
  method: 'GET', path: '/purchasing/orders/:id', auth: 'session', perm: 'purchasing:read', tx: read,
  input: z.object({ id: idString() }), output: order,
});
/** A new draft purchase order. */
export const createPurchaseOrder = defineContract({
  method: 'POST', path: '/purchasing/orders', auth: 'session', perm: 'purchasing:write', tx: write,
  input: orderIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/**
 * A draft rewritten whole; or a placed PO's lines, which stays placed. A placed PO raised above what was approved, or
 * above its placer's limit, is refused (`over_approved`, the architect on RAD-136) and keeps its lines: more goods go on
 * a new PO, a price rise is caught at the bill, and a rework is closing it short and raising another. Lowering it, or a
 * change within both, saves. A placed PO keeps its supplier and date, which its number and approval were given for
 * (`fixed_once_placed`), and no line goes below what has come in against it, nor is a received line removed
 * (`po_received`, as a sales order's `order_delivered`; the auditor on #333).
 */
export const updatePurchaseOrder = defineContract({
  method: 'PUT', path: '/purchasing/orders/:id', auth: 'session', perm: 'purchasing:write', tx: write,
  input: expectedAfter(orderShape.extend({ id: idString() })), output: z.object({}),
  errors: [...DRAFT_ERRORS, 'no_gst_rate', 'company_profile_incomplete', 'over_approved', 'fixed_once_placed', 'po_received'],
});
/** A draft thrown away: it never had a number, and any request for its approval is closed first. */
export const deletePurchaseOrder = defineContract({
  method: 'DELETE', path: '/purchasing/orders/:id', auth: 'session', perm: 'purchasing:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Places a draft: at once within its placer's limit, else by asking for approval. */
export const placePurchaseOrder = defineContract({
  method: 'POST', path: '/purchasing/orders/:id/place', auth: 'session', perm: 'purchasing:write', tx: write,
  input: z.object({ id: idString() }), output: placed, errors: [...PLACE_ERRORS],
});
/** The purchase orders' approval routes (RAD-38): someone other than the placer, holding purchasing:approve, decides,
 * and approving places it. Approving re-checks what can change while the request waits: the draft's status, its date
 * against the year and the period lock, its tax, that its supplier and items are still switched on, and the series
 * (the auditor on #333). */
export const purchaseOrderApproval = approvalContracts('purchase-order', 'purchasing:approve',
  ['wrong_status', 'no_gst_rate', 'company_profile_incomplete', 'year_not_open', 'period_locked', 'series_full', 'not_a_supplier',
    'item_inactive']);
/** Closes a placed PO with lines still to come, with the reason (closed short). */
export const closePurchaseOrder = defineContract({
  method: 'POST', path: '/purchasing/orders/:id/close', auth: 'session', perm: 'purchasing:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({}), errors: ['wrong_status'],
});
/** Cancels a draft or placed PO while nothing has been received against it. */
export const cancelPurchaseOrder = defineContract({
  method: 'POST', path: '/purchasing/orders/:id/cancel', auth: 'session', perm: 'purchasing:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({}), errors: ['wrong_status', 'po_received'],
});
/** A placed PO's A4 printout, or on the roll (RAD-120's engine). It isn't a tax document, so the supplier's personal
 * fields print as the screen shows them; a draft has no number yet. */
export const printPurchaseOrder = printContract('/purchasing/orders/:id/pdf', 'purchasing:read', 'purchase_orders', ['wrong_status']);

/** The PO limits (ADR-008 §5): each role's own, and the default a role without one takes (purchasing.order_limit_default,
 * 0 until set, so every PO is approved: Sarthak, 22 Nov). */
export const listPurchaseOrderLimits = defineContract({
  method: 'GET', path: '/purchasing/order-limits', auth: 'session', perm: 'purchasing:read', tx: read, input: z.object({}),
  output: z.object({ defaultMaxTotal: moneyString(), roles: z.array(z.object({ role: z.string(), maxTotal: moneyString() })) }),
});
/** Sets a role's PO limit, or the default when `role` is null; a null limit removes a role's own, so it takes the
 * default again (the default itself can't be removed: `default_required`). As the discount limits are set (the
 * architect on RAD-136). */
export const setPurchaseOrderLimit = defineContract({
  method: 'PUT', path: '/purchasing/order-limits', auth: 'session', perm: 'purchasing:approve', tx: write,
  input: z.object({ role: roleKey().nullable(), maxTotal: moneyString().nullable(), reason: reason() }), output: z.object({}),
  errors: ['unknown_role', 'default_required'],
});
