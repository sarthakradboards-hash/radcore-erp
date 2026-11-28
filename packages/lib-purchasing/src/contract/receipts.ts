// Goods receipts and QC (M4-02, RAD-137; ADR-008 §1, §3, §4, §6, §12, §13; ADR-006 §4a, §5, §6, F2, F21, F22),
// re-exported by ../contract.ts. Flow 5: goods arrive against one placed purchase order and are counted (inward:write),
// but aren't in stock until QC has split them (inward:qc). Posting the receipt is QC done: one save puts the accepted
// goods into their sellable place and the rejects into a rejects place, both at the PO line's rate, numbered
// GRN/YY-YY/NNNNN, with Dr Stock in Hand, Cr Goods Received Not Billed. Rejects never enter the selling average
// (RC-205). A posted receipt is cancelled by its mirror, only while nothing on it has been billed, returned or moved on.
// Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import { dateString, defineContract, idString, listInput, listOf, moneyString, quantityString, reason, unitPriceString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const lines = <T extends z.ZodType>(line: T) => z.array(line).min(1, 'Add at least one line').max(200, 'At most 200 lines');

/** What arrived on a line of the PO: how many, counted at the door, before QC (§6). */
const arrivalLineIn = z.object({ orderLineId: idString(), received: quantityString() });
const arrivalIn = z.object({
  orderId: idString(), businessDate: dateString(),
  /** Where the accepted goods go: a place of a sellable kind. */
  locationId: idString(),
  /** Where the rejects go: a place of kind `rejected` (`not_a_rejects_place` otherwise). */
  rejectsLocationId: idString(),
  /** The supplier's delivery challan or invoice number, as written on their paper, for finding it later. */
  supplierRef: z.string().trim().min(1).max(60).nullable(),
  notes: z.string().trim().max(500).nullable(), lines: lines(arrivalLineIn),
});

/**
 * A line's QC, as the inspector records it at posting (§6). Its accepted and rejected quantities add up to what was
 * received (`qc_mismatch` otherwise), split by the supplier's batch numbers (`batchNo` null: the receipt's own number
 * is the batch, ADR-006 §4a). A batch is the item's from this supplier, so another supplier's same number is another
 * batch (RC-028). A serialised item names each unit, accepted or rejected, in its batch, with its chassis number where
 * the item has the flag (F22): accepted units are `received` as `new`, rejected ones as `damaged`.
 */
const qcLineIn = z.object({
  lineId: idString(),
  batches: z.array(z.object({ batchNo: z.string().trim().min(1).max(60).nullable(), accepted: quantityString(), rejected: quantityString() }))
    .min(1).max(50),
  serials: z.array(z.object({ serialNo: z.string().trim().min(1).max(60), chassisNo: z.string().trim().min(1).max(40).nullable(),
    batchNo: z.string().trim().min(1).max(60).nullable(), rejected: z.boolean() })).max(1000),
  /** Why any of it was rejected; required when something was (`reject_reason_required`). */
  rejectReason: z.string().trim().min(1).max(300).nullable(),
});

const header = z.object({
  id: idString(), number: z.string().nullable(), orderId: idString(), orderNumber: z.string().nullable(), supplierId: idString(),
  supplierName: z.string(), businessDate: dateString(), status, locationId: idString(), locationName: z.string(),
  rejectsLocationId: idString(), rejectsLocationName: z.string(), supplierRef: z.string().nullable(),
  /** Accepted plus rejected, at the PO lines' rates: what Goods Received Not Billed accrued. Null while a draft. */
  value: moneyString().nullable(),
});
/**
 * A receipt line as answered. Until posting, only `received` is set. From posting on, `accepted` and `rejected` and
 * their values are frozen: each value is its quantity at the PO line's `rate`, rounded to the paisa, and is exactly what
 * the movement into its place and Goods Received Not Billed carry. A purchase bill (M4-03) clears that accrual, so it
 * reads these, never the rate times a quantity again.
 */
const lineOut = z.object({
  id: idString(), lineNo: z.number().int().positive(), orderLineId: idString(), itemId: idString(), sku: z.string(), name: z.string(),
  unit: z.string(), rate: unitPriceString(), ordered: quantityString(), received: quantityString(),
  accepted: quantityString().nullable(), rejected: quantityString().nullable(),
  acceptedValue: moneyString().nullable(), rejectedValue: moneyString().nullable(), rejectReason: z.string().nullable(),
  batches: z.array(z.object({ batchId: idString(), batchNo: z.string(), accepted: quantityString(), rejected: quantityString() })),
  serials: z.array(z.object({ serialNo: z.string(), chassisNo: z.string().nullable(), batchNo: z.string(), rejected: z.boolean() })),
});
const receipt = header.extend({ notes: z.string().nullable(), lines: z.array(lineOut) });

// What a draft's arrival can refuse: its dates (ADR-008 §4: not before the PO's), its PO and places, and its lines.
const ARRIVAL_ERRORS = ['date_in_future', 'year_not_open', 'period_locked', 'month_filed', 'date_before_source', 'unknown_order', 'order_not_placed',
  'unknown_order_line', 'unknown_location', 'location_inactive', 'place_not_sellable', 'not_a_rejects_place', 'quantity_too_precise',
  'qty_not_positive', 'over_ordered', 'wrong_status'] as const;
// What QC and posting add: the split, the batches and serials (checked by name before the database's RA007 and RA008),
// the stock engine's and the ledger's refusals, and the number.
const POST_ERRORS = [...ARRIVAL_ERRORS, 'qc_mismatch', 'reject_reason_required', 'serials_mismatch', 'serial_twice', 'not_serialised',
  'serial_sold', 'serial_in_stock', 'chassis_required', 'chassis_not_allowed', 'chassis_taken', 'account_inactive', 'series_full'] as const;

/** Goods receipts, newest first, a page at a time; the principal's own where that's their scope. */
export const listGoodsReceipts = defineContract({
  method: 'GET', path: '/purchasing/receipts', auth: 'session', perm: 'purchasing:read', tx: read,
  input: listInput(z.object({ status: status.optional(), supplierId: idString().optional(), orderId: idString().optional() })),
  output: listOf(header),
});
/** One receipt with its lines, their QC and their values. */
export const getGoodsReceipt = defineContract({
  method: 'GET', path: '/purchasing/receipts/:id', auth: 'session', perm: 'purchasing:read', tx: read,
  input: z.object({ id: idString() }), output: receipt,
});
/** Records what arrived against a placed PO, as a draft: nothing is in stock yet. Each line is at most what's left of
 * its PO line, counting every receipt of it posted or in draft (`over_ordered`: extra goods need a PO line of their
 * own, with no tolerance). */
export const createGoodsReceipt = defineContract({
  method: 'POST', path: '/purchasing/receipts', auth: 'session', perm: 'inward:write', tx: write,
  input: arrivalIn, output: z.object({ id: idString() }), errors: [...ARRIVAL_ERRORS],
});
/** A draft's arrival rewritten whole. */
export const updateGoodsReceipt = defineContract({
  method: 'PUT', path: '/purchasing/receipts/:id', auth: 'session', perm: 'inward:write', tx: write,
  input: arrivalIn.omit({ orderId: true }).extend({ id: idString() }), output: z.object({}), errors: [...ARRIVAL_ERRORS],
});
/** A draft thrown away: it never had a number. */
export const deleteGoodsReceipt = defineContract({
  method: 'DELETE', path: '/purchasing/receipts/:id', auth: 'session', perm: 'inward:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/**
 * QC done: posts the draft with each line's split, in one save (§6, F2). The accepted goods go into the receipt's
 * place and the rejects into its rejects place, both at the PO line's rate, with their batches and units, and the PO
 * line's received quantity grows; the PO closes once every line has all it ordered. A serial already sold (the
 * customer's) is refused `serial_sold`, one already in our stock `serial_in_stock`; one that went back to its supplier
 * can come in again. Every line of the draft is inspected in the one save (`qc_mismatch` for a line left out).
 */
export const postGoodsReceipt = defineContract({
  method: 'POST', path: '/purchasing/receipts/:id/post', auth: 'session', perm: 'inward:qc', tx: write,
  input: z.object({ id: idString(), lines: lines(qcLineIn) }),
  output: z.object({ number: z.string() }), errors: [...POST_ERRORS],
});
/** Cancels a posted receipt by its mirror, at the same values, dated the cancellation's day: only while nothing on it
 * has been billed, returned or moved on (`receipt_in_use`). Its PO lines' received quantities fall back with it. */
export const cancelGoodsReceipt = defineContract({
  method: 'POST', path: '/purchasing/receipts/:id/cancel', auth: 'session', perm: 'inward:qc', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'date_in_future', 'date_before_source', 'year_not_open', 'period_locked', 'month_filed', 'receipt_in_use', 'account_inactive',
    'not_enough_stock'],
});
