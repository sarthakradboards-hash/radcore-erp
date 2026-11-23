// Supplier returns and debit notes (M4-05, RAD-140; ADR-008 §1, §3, §4, §8, §12, §13; ADR-006 §6, F4; RC-129),
// re-exported by ../contract.ts. A return takes rejects back to their supplier, out of a place of kind `rejected`, each
// line naming the receipt line its goods came in on, so the supplier and the bill are known, never guessed. Posting
// splits each line by what was billed: the unbilled part first, back against Goods Received Not Billed (F4), then the
// billed part, a debit note against the bill that billed it (Dr Creditors, Cr Stock in Hand, Cr Input GST at that
// bill's rates), numbered DBN/YY-YY/NNNNN and applied to that bill in the same save. So only billed rejects are ever
// debited (RC-129). The return lowers its PO lines' received quantities, so a PO its receipts closed opens again and
// the replacement comes in on the same PO (Sarthak, 23 Nov, "Yes, same order"); a PO closed short stays closed. A
// return is undone by cancelling it. Like every contract file it imports only zod, lib-common and other libraries'
// contract entries (D5).
import { dateString, defineContract, idString, listInput, listOf, moneyString, quantityString, reason, unitPriceString } from '@radcore/lib-common';
import { printContract } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const money = () => moneyString();

/** A line: the receipt line its goods came in on, how many go back, in the batches they're picked from, and for a
 * serialised item each unit's serial. */
const lineIn = z.object({
  receiptLineId: idString(), qty: quantityString(),
  batches: z.array(z.object({ batchId: idString(), qty: quantityString() })).min(1).max(50),
  serials: z.array(z.string().trim().min(1).max(60)).max(1000),
});
const returnIn = z.object({
  supplierId: idString(), businessDate: dateString(),
  /** The rejects place the goods leave from: of kind `rejected` (`not_a_rejects_place` otherwise). Sellable stock goes
   * back by a transfer to rejects first (§9). */
  locationId: idString(),
  /** Why the goods go back: printed on the debit note. */
  reason: reason(),
  notes: z.string().trim().max(500).nullable(),
  lines: z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines'),
});

/** A line's billed part against one bill: its quantity, and the debit at that bill's line rate and GST rates. */
const billedOut = z.object({
  billId: idString(), billNumber: z.string(), billLineId: idString(), qty: quantityString(), rate: unitPriceString(),
  gstRate: z.string().nullable(), taxable: money(), cgst: money().nullable(), sgst: money().nullable(), igst: money().nullable(),
});
/**
 * A line as split (§8): unbilled first, at the receipt line's rate, then billed, against each bill that billed it.
 * Worked out on read while a draft (as it would post today), stored once posted.
 */
const lineOut = z.object({
  id: idString(), lineNo: z.number().int().positive(), receiptLineId: idString(),
  /** Its receipt and PO line, for a reader who may see that receipt (E7); null otherwise. */
  receiptId: idString().nullable(), receiptNumber: z.string().nullable(), orderLineId: idString().nullable(),
  itemId: idString(), sku: z.string(), name: z.string(), unit: z.string(), qty: quantityString(),
  batches: z.array(z.object({ batchId: idString(), batchNo: z.string(), qty: quantityString() })), serials: z.array(z.string()),
  /** The receipt line's rate, and its unbilled part's quantity and value: what Goods Received Not Billed gets back. */
  rate: unitPriceString(), unbilledQty: quantityString(), unbilledValue: money(),
  billed: z.array(billedOut),
});
/** The debit note: the billed part's totals, to the rupee as the bills it debits are. Null when nothing is billed. */
const debitNote = z.object({
  number: z.string().nullable(), placeOfSupply: z.string().nullable(), taxable: money(), cgst: money().nullable(),
  sgst: money().nullable(), igst: money().nullable(), roundOff: z.string(), total: money(),
});
const header = z.object({
  id: idString(), number: z.string().nullable(), supplierId: idString(), supplierName: z.string(), businessDate: dateString(), status,
  locationId: idString(), locationName: z.string(),
  /** The debit note's number and total, when the return has a billed part. */
  debitNoteNumber: z.string().nullable(), debitTotal: money().nullable(),
});
const supplierReturn = header.extend({
  reason: z.string(), notes: z.string().nullable(), lines: z.array(lineOut),
  /** What goes back against Goods Received Not Billed: the unbilled parts' values. */
  unbilledValue: money(), debitNote: debitNote.nullable(),
  /** While a draft, why its split can't be worked out yet (its receipt lines refuse it, say); null otherwise. */
  amountsNote: z.string().nullable(),
  /** Where the debit note is applied: to the bills it debits as it posts, and later to others by a person, oldest first. */
  applications: z.array(z.object({ id: idString(), documentId: idString(), documentNumber: z.string().nullable(), amount: money(),
    businessDate: dateString(), reversed: z.boolean() })),
  cancelReason: z.string().nullable(),
});

// What a draft's save can refuse: its supplier, its rejects place, its lines' receipt lines, their quantities and serials.
const DRAFT_ERRORS = ['date_in_future', 'unknown_party', 'not_a_supplier', 'unknown_location', 'location_inactive', 'not_a_rejects_place',
  'unknown_receipt_line', 'receipt_not_posted', 'other_supplier', 'quantity_too_precise', 'qty_not_positive', 'over_received',
  'unknown_batch', 'batches_mismatch', 'serials_mismatch', 'serial_twice', 'not_serialised', 'wrong_status'] as const;
// What posting adds: the dates (§4: not before its receipts, nor the bills it debits), the stock engine's and the
// ledger's refusals as the goods go out, the bills' tax, and its numbers.
const POST_ERRORS = [...DRAFT_ERRORS, 'year_not_open', 'period_locked', 'date_before_source', 'account_inactive', 'not_enough_stock',
  'units_mismatch', 'unit_held', 'unit_batch', 'no_estimate', 'company_profile_incomplete', 'series_full'] as const;

/** Supplier returns, newest first, a page at a time; the principal's own where that's their scope. */
export const listSupplierReturns = defineContract({
  method: 'GET', path: '/purchasing/returns', auth: 'session', perm: 'purchasing:read', tx: read,
  input: listInput(z.object({ status: status.optional(), supplierId: idString().optional() })),
  output: listOf(header),
});
/** One return with its lines, each split into its unbilled and billed parts, and its debit note. */
export const getSupplierReturn = defineContract({
  method: 'GET', path: '/purchasing/returns/:id', auth: 'session', perm: 'purchasing:read', tx: read,
  input: z.object({ id: idString() }), output: supplierReturn,
});
/** A new draft return. Each line is at most what came in on its receipt line, less what's gone back on other returns,
 * posted or in draft (`over_received`). */
export const createSupplierReturn = defineContract({
  method: 'POST', path: '/purchasing/returns', auth: 'session', perm: 'supplier_returns:write', tx: write,
  input: returnIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/** A draft rewritten whole. */
export const updateSupplierReturn = defineContract({
  method: 'PUT', path: '/purchasing/returns/:id', auth: 'session', perm: 'supplier_returns:write', tx: write,
  input: returnIn.omit({ supplierId: true }).extend({ id: idString() }), output: z.object({}), errors: [...DRAFT_ERRORS],
});
/** A draft thrown away: it never had a number. */
export const deleteSupplierReturn = defineContract({
  method: 'DELETE', path: '/purchasing/returns/:id', auth: 'session', perm: 'supplier_returns:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/**
 * Posts a draft (§8, F4): the goods leave the rejects place at the value they carry, their units `returned_to_supplier`
 * with their batches. Each line's unbilled part goes back against Goods Received Not Billed; its billed part is debited
 * against the bill that billed it, at that bill's rates, as a debit note with its own number, applied to that bill
 * while it has anything open (what's left stays as credit with the supplier). Numbered SR/YY-YY/NNNNN. Its PO lines'
 * received quantities fall by what went back, so a PO its receipts closed opens again for the replacement.
 */
export const postSupplierReturn = defineContract({
  method: 'POST', path: '/purchasing/returns/:id/post', auth: 'session', perm: 'supplier_returns:write', tx: write,
  input: z.object({ id: idString() }),
  output: z.object({ number: z.string(), debitNoteNumber: z.string().nullable() }), errors: [...POST_ERRORS],
});
/**
 * Undoes a posted return (RC-129): its debit note's applications reversed first, then its entry and movements mirrored
 * on the cancellation's day, its units back at the rejects place as `received`, and its PO lines' received quantities
 * back up. Refused once the replacement has come in on the PO (`replacement_received`: the line would hold more than it
 * ordered), and while the supplier has refunded the debit note (`still_applied`).
 */
export const cancelSupplierReturn = defineContract({
  method: 'POST', path: '/purchasing/returns/:id/cancel', auth: 'session', perm: 'supplier_returns:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'date_in_future', 'date_before_source', 'year_not_open', 'period_locked', 'account_inactive', 'replacement_received',
    'still_applied', 'units_mismatch', 'not_reversible', 'already_reversed'],
  dbErrors: { 'RA006:document_still_applied': { code: 'still_applied', message: 'This debit note is still applied or refunded: reverse that first' } },
});
/** A posted return's A4 printout: the debit note for its billed part, and the goods that went back. It's sent to the
 * supplier, so it prints their name, address, state and GSTIN in full (§8, RAD-120's statutory rule); a draft has no
 * number yet. */
export const printSupplierReturn = printContract('/purchasing/returns/:id/pdf', 'purchasing:read', 'supplier_returns', ['wrong_status']);
