// Purchase bills (M4-03, RAD-138; ADR-008 §1, §3, §4, §7, §7a, §12, §13; RC-023, RC-056, RC-172), re-exported by
// ../contract.ts. A bill is what a supplier's own invoice says, entered as a draft with its file, then posted: numbered
// PB/YY-YY/NNNNN, clearing Goods Received Not Billed for exactly what it bills, with any price difference to stock or
// cost of goods sold. Each goods line bills a receipt line (and through it a PO line); a bill that comes before the
// goods names PO lines and waits as a draft. A line billed more than purchasing.bill_tolerance_pct above its PO rate,
// or charges above it as a share of the goods, waits for someone else's approval under bills:approve, which posts it.
// Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import {
  dateString, defineContract, gstinString, idString, listInput, listOf, moneyString, quantityString, reason, unitPriceString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const money = () => moneyString().nullable();
const hsn = () => z.string().regex(/^[0-9]{4}([0-9]{2}){0,2}$/, 'Enter the 4, 6 or 8-digit HSN or SAC code');
/** The supplier's own invoice number, as printed: compared in upper case and trimmed, "/" and "-" kept (ADR-008 §7).
 * Up to 40 characters, as payments.reference: Rule 46's 16 binds a registered supplier's tax invoice, not an
 * unregistered, service or import supplier's bill (the auditor on #361). */
const supplierNumber = () => z.string().trim().min(1, 'Enter the supplier’s invoice number').max(40, 'At most 40 characters');

/** A goods line: the PO line it's for, and once the goods are in, the receipt line it bills; how many, at what rate
 * before tax, as the supplier's bill says. */
const goodsIn = z.object({ kind: z.literal('goods'), poLineId: idString(), receiptLineId: idString().nullable(), qty: quantityString(),
  rate: unitPriceString() });
/** A charge on the goods (freight, packing, insurance): its taxable amount and its HSN or SAC for the tax. It's part of
 * the goods' cost, spread over the goods lines by value. */
const chargeIn = z.object({ kind: z.literal('charge'), charge: z.enum(['freight', 'packing', 'insurance', 'other']),
  description: z.string().trim().min(1).max(100), hsn: hsn(), amount: moneyString() });
/** A job worker's charge (ADR-008 §11, RAD-142): the job-work receipt line whose made goods it bills, how many, at what
 * rate before tax, and the service's SAC, as the job worker's bill says. */
const jobWorkIn = z.object({ kind: z.literal('job_work'), jobWorkReceiptLineId: idString(), qty: quantityString(), rate: unitPriceString(),
  hsn: hsn() });
const lineIn = z.discriminatedUnion('kind', [goodsIn, chargeIn, jobWorkIn]);
/** A line's tax, worked out by lib-gst from the bill's own lines at the rates in force on the supplier's invoice date,
 * never at the PO's (RC-056): on read while a draft, stored when posted. */
const lineAmounts = z.object({ gstRate: z.string().nullable(), gstRateSource: z.string().nullable(), taxable: moneyString(), cgst: money(), sgst: money(), igst: money(),
  lineTotal: money(),
  /** A reverse-charge charge's tax by head (ADR-010 §4, RAD-153): ours to pay, not on the supplier's bill, whose own heads
   * are then 0. Null on any other line, and while a draft's tax can't be worked out. */
  reverseCharge: z.object({ cgst: moneyString(), sgst: moneyString(), igst: moneyString() }).nullable() });
const lineOut = z.discriminatedUnion('kind', [
  goodsIn.extend({ id: idString(), lineNo: z.number().int().positive(), itemId: idString(), sku: z.string(), name: z.string(),
    unit: z.string(), poRate: unitPriceString(), poNumber: z.string(),
    /** How far its rate is above its PO line's, in percent (0 at or below it), and whether that's past the tolerance.
     * Null for a free item's line (a PO rate of 0) billed at a price: there's no percentage, and it's past the tolerance. */
    overPoRate: z.string().nullable(), overTolerance: z.boolean(), amounts: lineAmounts }),
  chargeIn.extend({ id: idString(), lineNo: z.number().int().positive(), amounts: lineAmounts }),
  /** Its made item, the receipt's number and charge rate, and how far its rate is above that, as a goods line's is above
   * its PO's. Those four are null for a reader who can't see the job-work receipt (stock:read, by its maker). */
  jobWorkIn.extend({ id: idString(), lineNo: z.number().int().positive(), itemId: idString(), sku: z.string(), name: z.string(),
    unit: z.string(), chargeRate: unitPriceString().nullable(), receiptNumber: z.string().nullable(), overChargeRate: z.string().nullable(),
    overTolerance: z.boolean().nullable(), amounts: lineAmounts }),
]);
const lines = () => z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines');
/** The bill's totals, to the rupee, with `note` saying what's missing while a draft's tax can't be worked out. */
const amounts = z.object({ placeOfSupply: z.string().nullable(), taxable: moneyString(), cgst: money(), sgst: money(), igst: money(),
  roundOff: z.string().nullable(), total: money(), note: z.string().nullable() });
const header = z.object({
  id: idString(), number: z.string().nullable(), supplierId: idString(), supplierName: z.string(), businessDate: dateString(), status,
  supplierInvoiceNumber: z.string(), supplierInvoiceDate: dateString(), total: money(),
  /** Whether a request for its approval is waiting: a line or the charges past the tolerance. */
  awaitingApproval: z.boolean(),
  /** What's still to pay on a posted bill: its total less the payments allocated and debit notes applied to it (ADR-008
   * §7, ADR-005 §7a). Null while a draft, and for a cancelled bill (RAD-143, the architect). */
  open: money(),
});
const bill = header.extend({
  /** The GSTIN as printed on the supplier's bill: the party's own, or none for an unregistered supplier. */
  supplierGstin: gstinString().nullable(),
  /** The total the supplier's bill states, which posting holds the worked-out total to within the round-off. */
  statedTotal: moneyString(),
  /** The supplier's bill itself (file kind purchase_bill); a bill posts only with it (RC-172). */
  fileId: idString().nullable(),
  notes: z.string().nullable(), amounts, lines: z.array(lineOut),
  /** Whether the charges, as a share of the goods' value, are past the tolerance. */
  chargesOverTolerance: z.boolean(),
  cancelReason: z.string().nullable(),
});
const billShape = z.object({ supplierId: idString(), businessDate: dateString(), supplierInvoiceNumber: supplierNumber(),
  supplierInvoiceDate: dateString(), supplierGstin: gstinString().nullable(), statedTotal: moneyString(), fileId: idString().nullable(),
  notes: z.string().trim().max(500).nullable(), lines: lines() });
/** The supplier's invoice date is theirs: before the bill's own date or on it, never after (ADR-008 §4). */
const supplierDated = <T extends z.ZodType<{ businessDate: string; supplierInvoiceDate: string }>>(s: T) =>
  s.refine((b) => b.supplierInvoiceDate <= b.businessDate, { path: ['supplierInvoiceDate'], message: 'On or before the bill’s own date' });

// What a draft's save can refuse: its dates, its supplier and GSTIN, its lines' PO and receipt lines, its file (lib-platform's
// readyFile: another kind, still being checked, or refused), and its status.
const DRAFT_ERRORS = ['date_in_future', 'supplier_date_after_bill', 'unknown_party', 'not_a_supplier', 'overseas_services_only', 'gstin_mismatch',
  'unknown_po_line', 'po_not_placed', 'other_supplier', 'unknown_receipt_line', 'receipt_not_posted', 'not_this_po_line',
  'quantity_too_precise', 'wrong_file_kind', 'not_ready', 'upload_refused', 'duplicate_bill', 'wrong_status'] as const;
// What posting adds: the dates (ADR-008 §4), the file, the duplicate, the three-way match, the tax and stated total, the
// approved version still holding, and the series.
const POST_ERRORS = [...DRAFT_ERRORS, 'year_not_open', 'period_locked', 'date_before_source', 'bill_file_required', 'goods_not_received',
  'over_received', 'no_gst_rate', 'company_profile_incomplete', 'total_mismatch', 'rcm_bill_has_tax', 'nothing_to_revalue', 'account_inactive', 'version_changed', 'series_full'] as const;
// The duplicate check is the database's: a partial unique index on (party, the invoice's financial year, its key) over
// every bill that isn't cancelled, drafts too (ADR-008 §7), so a draft's save meets it as posting does.
const BILL_DB_ERRORS = {
  '23505:ux_purchase_bills_supplier_invoice': { code: 'duplicate_bill', message: 'This supplier’s bill with that number is already entered for that year' },
} as const;
/** What posting answers: posted (with its number), or waiting for approval (with the request's id and the version hash
 * it was asked for), when a line or the charges are past the tolerance. */
const posted = z.object({ status: z.enum(['posted', 'pending_approval']), number: z.string().nullable(), approvalId: idString().nullable(),
  versionHash: z.string().nullable() });

/** Purchase bills, newest first, a page at a time; the principal's own where that's their scope. */
export const listPurchaseBills = defineContract({
  method: 'GET', path: '/purchasing/bills', auth: 'session', perm: 'purchasing:read', tx: read,
  // `open`: only posted bills with something still to pay, for applying a payment out to them (RAD-143).
  input: listInput(z.object({ status: status.optional(), supplierId: idString().optional(), open: z.literal(true).optional() })),
  output: listOf(header),
});
/** One purchase bill, with its lines, how each stands against its PO rate, and its amounts. */
export const getPurchaseBill = defineContract({
  method: 'GET', path: '/purchasing/bills/:id', auth: 'session', perm: 'purchasing:read', tx: read,
  input: z.object({ id: idString() }), output: bill,
});
/** A new draft bill. */
export const createPurchaseBill = defineContract({
  method: 'POST', path: '/purchasing/bills', auth: 'session', perm: 'bills:write', tx: write,
  input: supplierDated(billShape), output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS], dbErrors: BILL_DB_ERRORS,
});
/** A draft rewritten whole: its receipt lines named once the goods are in, its file attached. */
export const updatePurchaseBill = defineContract({
  method: 'PUT', path: '/purchasing/bills/:id', auth: 'session', perm: 'bills:write', tx: write,
  input: supplierDated(billShape.extend({ id: idString() })), output: z.object({}), errors: [...DRAFT_ERRORS], dbErrors: BILL_DB_ERRORS,
});
/** A draft thrown away: any request for its approval is closed first. */
export const deletePurchaseBill = defineContract({
  method: 'DELETE', path: '/purchasing/bills/:id', auth: 'session', perm: 'bills:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Posts a draft: at once within the tolerance, else by asking for approval. */
export const postPurchaseBill = defineContract({
  method: 'POST', path: '/purchasing/bills/:id/post', auth: 'session', perm: 'bills:write', tx: write,
  input: z.object({ id: idString() }), output: posted, errors: [...POST_ERRORS], dbErrors: BILL_DB_ERRORS,
});
/** The bills' approval routes (RAD-38): someone other than the poster, holding bills:approve, decides, and approving
 * posts it. Approving re-checks what can change while the request waits: the draft's status, its dates against the year
 * and the period lock, the supplier still one we buy from with the same GSTIN, the receipt lines still unbilled, the
 * tax, the duplicate, and the series. */
export const purchaseBillApproval = approvalContracts('purchase-bill', 'bills:approve',
  ['wrong_status', 'year_not_open', 'period_locked', 'date_before_source', 'not_a_supplier', 'gstin_mismatch', 'over_received',
    'receipt_not_posted', 'duplicate_bill', 'goods_not_received', 'bill_file_required', 'not_this_po_line', 'unknown_receipt_line',
    'nothing_to_revalue', 'account_inactive', 'overseas_services_only',
    'no_gst_rate', 'company_profile_incomplete', 'total_mismatch', 'rcm_bill_has_tax', 'series_full'], BILL_DB_ERRORS);
/** Cancels a posted bill by a mirror entry dated `businessDate`, with the reason: only while nothing is applied to it
 * and no supplier return has debited it. */
export const cancelPurchaseBill = defineContract({
  method: 'POST', path: '/purchasing/bills/:id/cancel', auth: 'session', perm: 'bills:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'date_before_source', 'date_in_future', 'year_not_open', 'period_locked', 'still_applied', 'bill_returned',
    'nothing_to_revalue', 'account_inactive'],
  dbErrors: { 'RA006:document_still_applied': { code: 'still_applied', message: 'Payments or debit notes are still applied to this bill: reverse them first' } },
});
