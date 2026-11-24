// Job work (M4-07, RAD-142; ADR-008 §11, §12, §13; ADR-006 §4, §6, F16), re-exported by ../contract.ts. A challan
// sends inputs from a place of ours to the job worker's own place (kind `job_work`, one per job worker, found by its
// party). It's the delivery challan Rule 55 asks for goods sent for job work, so it prints the job worker in full. A
// receipt answers the challan's lines: the goods made (in at the inputs used plus the charge), the inputs used, those
// back unused, and those lost. Each posts at once with its number, as a transfer does, and is undone by cancelling,
// never deleted. Quantities and charges are the documents' own; stock values are cost(), masked without cost:read.
// Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import {
  cost, dateString, defineContract, idString, listInput, listOf, moneyString, quantityString, reason, unitPriceString,
} from '@radcore/lib-common';
import { printContract } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['posted', 'cancelled']);
const notes = z.string().trim().min(1).max(500).nullable();

/** What moves: a quantity, from the batches it's picked from ("batch unknown" is null), and a serialised item's serials. */
const batchesIn = z.array(z.object({ batchId: idString().nullable(), qty: quantityString() })).max(50);
const serialsIn = z.array(z.string().trim().min(1).max(60)).max(1000);
const partIn = z.object({ qty: quantityString(), batches: batchesIn, serials: serialsIn });
const lines = <T extends z.ZodType>(line: T) => z.array(line).min(1, 'Add at least one line').max(200, 'At most 200 lines');
const batchesOut = z.array(z.object({ batchId: idString().nullable(), batchNo: z.string().nullable(), qty: quantityString() }));
const item = { itemId: idString(), sku: z.string(), name: z.string() };
const cancelIn = z.object({ id: idString(), businessDate: dateString(), reason: reason() });

// What the stock engine and the ledger refuse as a document posts (ADR-006 §4, §6).
const POSTING_ERRORS = ['year_not_open', 'period_locked', 'account_inactive', 'not_enough_stock', 'batches_mismatch', 'units_mismatch',
  'serial_twice', 'not_serialised', 'unit_held', 'no_estimate', 'series_full'] as const;
// What a document's places and lines are refused for.
const LINE_ERRORS = ['unknown_location', 'location_inactive', 'unknown_item', 'quantity_too_precise', 'qty_not_positive', 'date_in_future'] as const;

// ---- Challans ----

const challanHeader = z.object({
  id: idString(), number: z.string(), fromId: idString(), fromName: z.string(), partyId: idString(), partyName: z.string(),
  businessDate: dateString(), status,
  // Section 143: an open challan's age in days, and whether it's past stock.job_work_return_days (365). What tax then
  // falls due is CA-51's question. Closed once everything it sent is accounted for, by its receipts.
  open: z.boolean(), ageDays: z.number().int().nonnegative(), pastReturnDays: z.boolean(),
});
/** A challan line: what went, and what its receipts have accounted for of it, made from, used, back and lost. */
const challanLine = z.object({
  id: idString(), lineNo: z.number().int().positive(), ...item, qty: quantityString(), batches: batchesOut, serials: z.array(z.string()),
  used: quantityString(), back: quantityString(), lost: quantityString(), left: quantityString(),
  // Of `serials`, those still at the job worker's place: the ones a receipt can still account for (ui on RAD-144).
  serialsOut: z.array(z.string()),
  value: cost(moneyString().nullable()),
});
const challan = challanHeader.extend({ notes: z.string().nullable(), cancelReason: z.string().nullable(), lines: z.array(challanLine) });

/** Job work challans, newest first, a page at a time: a job worker's, the open ones, or those past their return days. */
export const listJobWorkChallans = defineContract({
  method: 'GET', path: '/stock/job-work/challans', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ status: status.optional(), partyId: idString().optional(), open: z.literal(true).optional(),
    pastReturnDays: z.literal(true).optional() })),
  output: listOf(challanHeader),
});
/** One challan, with what each line sent and what's been accounted for of it. */
export const getJobWorkChallan = defineContract({
  method: 'GET', path: '/stock/job-work/challans/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }), output: challan,
});
/**
 * Sends inputs to a job worker, posted at once with its number (F16): out of a place of ours, in at the job worker's
 * own place, at the inputs' average, with their batches; serialised inputs go `sent_to_job_work`. The job worker is a
 * party with a job work place (`no_job_work_place` otherwise). Refused from a place that isn't ours to send from: a
 * job worker's (`use_job_work`), or rejects (`needs_qc`: a reject is re-inspected or returned to its supplier first,
 * the architect on RAD-141).
 */
export const createJobWorkChallan = defineContract({
  method: 'POST', path: '/stock/job-work/challans', auth: 'session', perm: 'job_work:write', tx: write,
  input: z.object({ fromId: idString(), partyId: idString(), businessDate: dateString(), notes,
    lines: lines(z.object({ itemId: idString(), ...partIn.shape })) }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['unknown_party', 'no_job_work_place', 'use_job_work', 'needs_qc', ...LINE_ERRORS, ...POSTING_ERRORS],
});
/** Undoes a challan with no receipt answering it (`challan_answered` otherwise): its mirror, dated the cancellation's
 * day, on or after the challan's; refused once a unit it sent has moved on since (`goods_moved_on`). */
export const cancelJobWorkChallan = defineContract({
  method: 'POST', path: '/stock/job-work/challans/:id/cancel', auth: 'session', perm: 'job_work:write', tx: write,
  input: cancelIn, output: z.object({}),
  errors: ['wrong_status', 'challan_answered', 'goods_moved_on', 'date_in_future', 'date_before_source', 'year_not_open', 'period_locked',
    'account_inactive', 'not_enough_stock'],
});
/**
 * The challan as Rule 55 asks: the job worker's name, address, state and GSTIN, and the goods' value, in full (a
 * statutory print). Under job_work:write, since the values print whoever prints it (the architect on RAD-142).
 */
export const printJobWorkChallan = printContract('/stock/job-work/challans/:id/pdf', 'job_work:write', 'job_work_challans', ['wrong_status']);

// ---- Receipts ----

const receiptHeader = z.object({
  id: idString(), number: z.string(), challanId: idString(), challanNumber: z.string(), partyId: idString(), partyName: z.string(),
  locationId: idString(), locationName: z.string(), businessDate: dateString(), status,
});
/** What a receipt says of one challan line. Values are cost(); the charge is the job worker's, so it's shown. */
const receiptLine = z.object({
  id: idString(), lineNo: z.number().int().positive(), challanLineId: idString(), input: z.object(item),
  made: z.object({ ...item, qty: quantityString(), serials: z.array(z.string()), chargeRate: unitPriceString(), charge: moneyString(),
    value: cost(moneyString()) }).nullable(),
  used: z.object({ qty: quantityString(), batches: batchesOut, serials: z.array(z.string()) }),
  back: z.object({ qty: quantityString(), batches: batchesOut, serials: z.array(z.string()) }),
  lost: z.object({ qty: quantityString(), batches: batchesOut, serials: z.array(z.string()), value: cost(moneyString()) }),
});
const receipt = receiptHeader.extend({ notes: z.string().nullable(), cancelReason: z.string().nullable(), charges: moneyString(),
  lines: z.array(receiptLine) });

/** Job work receipts, newest first, a page at a time: a challan's, or a job worker's. */
export const listJobWorkReceipts = defineContract({
  method: 'GET', path: '/stock/job-work/receipts', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ challanId: idString().optional(), partyId: idString().optional(), status: status.optional() })),
  output: listOf(receiptHeader),
});
/** One receipt, line by line. */
export const getJobWorkReceipt = defineContract({
  method: 'GET', path: '/stock/job-work/receipts/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }), output: receipt,
});
/**
 * Accounts for what a challan sent, posted at once with its number (F16), dated on or after the challan
 * (`date_before_source`). Each line names one of the challan's lines and says, of its inputs:
 * - `made`: the goods made from them, an item and quantity, and its charge rate. They come into `locationId`, one of
 *   ours, at the inputs used plus the charge. A serialised output names each serial, and each becomes a unit `received`
 *   with the receipt's number as its batch (RC-130); without them the receipt is refused (`units_mismatch`);
 * - `used`: what went into them, out of the job worker's place; a serialised input used is `scrapped`;
 * - `back`: unused, returned to `locationId`, `received_from_job_work`;
 * - `lost`: to Stock Adjustment, units `scrapped`.
 * Altogether at most what the challan line sent, less what earlier receipts accounted for (`over_challan`). Goods made
 * need inputs used (`made_without_use`), and inputs used need goods made (`used_without_made`): an input either went
 * into what was made, came back, or was lost (§11). The charge accrues to Job Work Charges to be Billed, cleared by the job
 * worker's purchase bill (ADR-008 §7).
 */
export const createJobWorkReceipt = defineContract({
  method: 'POST', path: '/stock/job-work/receipts', auth: 'session', perm: 'job_work:write', tx: write,
  input: z.object({
    challanId: idString(), locationId: idString(), businessDate: dateString(), notes,
    lines: lines(z.object({
      challanLineId: idString(),
      made: z.object({ itemId: idString(), qty: quantityString(), chargeRate: unitPriceString(), serials: serialsIn }).nullable(),
      used: partIn, back: partIn, lost: partIn,
    })),
  }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['unknown_challan', 'wrong_status', 'not_on_challan', 'over_challan', 'made_without_use', 'used_without_made', 'use_job_work', 'needs_qc',
    'date_before_source', ...LINE_ERRORS, ...POSTING_ERRORS],
});
/** Undoes a receipt while what it brought in is still where it went (`goods_moved_on` otherwise): its mirror, dated
 * the cancellation's day, which opens the challan's lines again. Refused once a purchase bill names its charges
 * (`charges_billed`). */
export const cancelJobWorkReceipt = defineContract({
  method: 'POST', path: '/stock/job-work/receipts/:id/cancel', auth: 'session', perm: 'job_work:write', tx: write,
  input: cancelIn, output: z.object({}),
  errors: ['wrong_status', 'goods_moved_on', 'charges_billed', 'date_in_future', 'date_before_source', 'year_not_open', 'period_locked',
    'account_inactive', 'not_enough_stock'],
  // A bill that isn't cancelled names its charges (ADR-008 §11): the database's guard, since lib-stock can't read bills.
  dbErrors: { 'RA006:job_work_charges_billed': { code: 'charges_billed', message: 'A purchase bill names this receipt’s charges: cancel the bill first' } },
});
