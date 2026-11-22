// Stock transfers, counts and adjustments (M4-06, RAD-141; ADR-008 §9, §10, §12, §13; ADR-006 §6, F13, F14, F21),
// re-exported by ../contract.ts. A transfer moves goods between two places and posts at once (no approval); a count
// records what was found at a place as at a moment, and an adjustment a one-off in or out with a reason, and both post
// only when someone else approves (stock:approve). Every one is cancelled by its mirror, never deleted once posted.
// Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import {
  cost, dateString, defineContract, idString, listInput, listOf, momentString, moneyString, quantityString, reason, UNIT_CONDITIONS,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const money = () => moneyString();

/** What a line moves: an item's quantity, in the batches it's picked from ("batch unknown" is null), and for a
 * serialised item the serials. */
const batchesIn = z.array(z.object({ batchId: idString().nullable(), qty: quantityString() })).max(50);
const serialsIn = z.array(z.string().trim().min(1).max(60)).max(1000);
const moveLineIn = z.object({ itemId: idString(), qty: quantityString(), batches: batchesIn, serials: serialsIn });
const lines = <T extends z.ZodType>(line: T) => z.array(line).min(1, 'Add at least one line').max(200, 'At most 200 lines');
const batchesOut = z.array(z.object({ batchId: idString().nullable(), batchNo: z.string().nullable(), qty: quantityString() }));
/** A line as a screen shows it: its item's SKU and name, and its value at cost, for those who may see cost. */
const lineOut = { id: idString(), lineNo: z.number().int().positive(), itemId: idString(), sku: z.string(), name: z.string() };
const cancelIn = z.object({ id: idString(), businessDate: dateString(), reason: reason() });

// What the stock engine and the ledger refuse as a document posts (ADR-006 §4, §6).
const POSTING_ERRORS = ['year_not_open', 'period_locked', 'account_inactive', 'not_enough_stock', 'batches_mismatch', 'units_mismatch',
  'serial_twice', 'not_serialised', 'unit_held', 'no_estimate'] as const;
// What a draft's places and lines are refused for.
const LINE_ERRORS = ['unknown_location', 'location_inactive', 'unknown_item', 'quantity_too_precise', 'qty_not_positive', 'date_in_future'] as const;
// A cancellation: dated on or after what it undoes, and only while what it moved is still where it went (§9).
const CANCEL_ERRORS = ['wrong_status', 'date_in_future', 'date_before_source', 'goods_moved_on', 'year_not_open', 'period_locked',
  'account_inactive', 'not_enough_stock'] as const;

// ---- Transfers (§9) ----

const transferHeader = z.object({
  id: idString(), number: z.string().nullable(), fromId: idString(), fromName: z.string(), toId: idString(), toName: z.string(),
  businessDate: dateString(), status, reason: z.string(),
  // A re-inspection out of `rejected` (§9): the condition its serialised units were found in; null for any other transfer.
  requalified: z.enum(['new', 'used']).nullable(),
});
const transfer = transferHeader.extend({
  lines: z.array(z.object({ ...lineOut, qty: quantityString(), batches: batchesOut, serials: z.array(z.string()),
    value: cost(money().nullable()) })),
});

/** Stock transfers, newest first, a page at a time. */
export const listStockTransfers = defineContract({
  method: 'GET', path: '/stock/transfers', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ status: status.optional(), locationId: idString().optional() })),
  output: listOf(transferHeader),
});
/** One transfer with its lines. */
export const getStockTransfer = defineContract({
  method: 'GET', path: '/stock/transfers/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }), output: transfer,
});
/**
 * Moves goods from one place to another, posted at once with its number (§9, F13): the batches and serials named go
 * out and come in under the same batches. Refused to the same place (`transfer_same_location`), out of `rejected` to a
 * sellable place unless it's a re-inspection under inward:qc (`needs_qc`), and to or from a job work place
 * (`use_job_work`, §11).
 */
export const createStockTransfer = defineContract({
  method: 'POST', path: '/stock/transfers', auth: 'session', perm: 'stock:move', tx: write,
  input: z.object({ fromId: idString(), toId: idString(), businessDate: dateString(), reason: reason(),
    requalified: z.enum(['new', 'used']).nullable(), lines: lines(moveLineIn) }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['transfer_same_location', 'needs_qc', 'use_job_work', ...LINE_ERRORS, ...POSTING_ERRORS],
});
/** Undoes a posted transfer (RC-124): its mirror at the same values, dated the cancellation's day; refused once the
 * goods have left where it put them, or a unit on it has moved since (`goods_moved_on`). */
export const cancelStockTransfer = defineContract({
  method: 'POST', path: '/stock/transfers/:id/cancel', auth: 'session', perm: 'stock:move', tx: write,
  input: cancelIn, output: z.object({}), errors: [...CANCEL_ERRORS],
});

// ---- Counts (§10) ----

const approval = z.enum(['none', 'pending', 'approved']);
const countHeader = z.object({
  id: idString(), number: z.string().nullable(), locationId: idString(), locationName: z.string(), countedAt: momentString(),
  businessDate: dateString(), status,
});
/** A count line: what was found, the book quantity as at `countedAt`, and the difference that posts (found less book),
 * worked out on read while it's a draft and stored once posted; its value at cost, for those who may see cost. */
const countLine = z.object({ ...lineOut, batchId: idString().nullable(), batchNo: z.string().nullable(), found: quantityString(),
  book: quantityString({ signed: true }), difference: quantityString({ signed: true }), serials: z.array(z.string()),
  value: cost(money().nullable()) });
const count = countHeader.extend({ reason: z.string(), approval, lines: z.array(countLine) });
/** Lines for the same item and batch are summed into one (RC-123): two people counting two shelves add up. */
const countIn = z.object({
  locationId: idString(), countedAt: momentString(), businessDate: dateString(), reason: reason(),
  lines: lines(z.object({ itemId: idString(), batchId: idString().nullable(), qty: quantityString(), serials: serialsIn })),
});
// A count's lines: a batch of another item, a serial counted twice or booked at another place (§10), a moment ahead.
const COUNT_ERRORS = [...LINE_ERRORS, 'unknown_batch', 'serial_twice', 'not_serialised', 'serial_elsewhere', 'counted_in_future'] as const;

/** Stock counts, newest first, a page at a time. */
export const listStockCounts = defineContract({
  method: 'GET', path: '/stock/counts', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ status: status.optional(), locationId: idString().optional() })),
  output: listOf(countHeader),
});
/** One count with its lines, their differences and where its approval stands. */
export const getStockCount = defineContract({
  method: 'GET', path: '/stock/counts/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }), output: count,
});
/** A new draft count. */
export const createStockCount = defineContract({
  method: 'POST', path: '/stock/counts', auth: 'session', perm: 'stock:count', tx: write,
  input: countIn, output: z.object({ id: idString() }), errors: [...COUNT_ERRORS],
});
/** A draft count, rewritten whole. */
export const updateStockCount = defineContract({
  method: 'PUT', path: '/stock/counts/:id', auth: 'session', perm: 'stock:count', tx: write,
  input: countIn.extend({ id: idString() }), output: z.object({}), errors: ['wrong_status', ...COUNT_ERRORS],
});
/** A draft count, thrown away; a pending approval request is closed with it (withdrawPending, RAD-114). */
export const deleteStockCount = defineContract({
  method: 'DELETE', path: '/stock/counts/:id', auth: 'session', perm: 'stock:count', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Sends a draft count for approval by someone other than its counter (flow 7); nothing posts until then. */
export const requestStockCountApproval = defineContract({
  method: 'POST', path: '/stock/counts/:id/approval', auth: 'session', perm: 'stock:count', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }),
  errors: ['wrong_status', 'serial_elsewhere', 'counted_in_future'],
});
/** The count approval routes (RAD-38): approving posts the differences (F14, F21). */
export const stockCountApproval = approvalContracts('stock-count', 'stock:approve',
  ['wrong_status', 'serial_elsewhere', ...POSTING_ERRORS]);
/** Cancels a posted count: its mirror, dated the cancellation's day. */
export const cancelStockCount = defineContract({
  method: 'POST', path: '/stock/counts/:id/cancel', auth: 'session', perm: 'stock:approve', tx: write,
  input: cancelIn, output: z.object({}), errors: [...CANCEL_ERRORS],
});

// ---- Adjustments (§10) ----

const direction = z.enum(['in', 'out']);
const adjustmentHeader = z.object({
  id: idString(), number: z.string().nullable(), locationId: idString(), locationName: z.string(), businessDate: dateString(), status,
});
const adjustment = adjustmentHeader.extend({
  reason: z.string(), approval,
  lines: z.array(z.object({ ...lineOut, direction, qty: quantityString(), batches: batchesOut, serials: z.array(z.string()),
    // For a serialised unit coming in: the condition it's found in.
    condition: z.enum(UNIT_CONDITIONS).nullable(), value: cost(money().nullable()) })),
});
/** Goods damaged, lost (`out`) or found (`in`), with a reason. A found serialised unit names its condition. */
const adjustmentIn = z.object({
  locationId: idString(), businessDate: dateString(), reason: reason(),
  lines: lines(moveLineIn.extend({ direction, condition: z.enum(UNIT_CONDITIONS).nullable() })),
});
const ADJUSTMENT_ERRORS = [...LINE_ERRORS, 'unknown_batch', 'serial_twice', 'not_serialised', 'serial_elsewhere'] as const;

/** Stock adjustments, newest first, a page at a time. */
export const listStockAdjustments = defineContract({
  method: 'GET', path: '/stock/adjustments', auth: 'session', perm: 'stock:read', tx: read,
  input: listInput(z.object({ status: status.optional(), locationId: idString().optional() })),
  output: listOf(adjustmentHeader),
});
/** One adjustment with its lines and where its approval stands. */
export const getStockAdjustment = defineContract({
  method: 'GET', path: '/stock/adjustments/:id', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({ id: idString() }), output: adjustment,
});
/** A new draft adjustment. */
export const createStockAdjustment = defineContract({
  method: 'POST', path: '/stock/adjustments', auth: 'session', perm: 'stock:count', tx: write,
  input: adjustmentIn, output: z.object({ id: idString() }), errors: [...ADJUSTMENT_ERRORS],
});
/** A draft adjustment, rewritten whole. */
export const updateStockAdjustment = defineContract({
  method: 'PUT', path: '/stock/adjustments/:id', auth: 'session', perm: 'stock:count', tx: write,
  input: adjustmentIn.extend({ id: idString() }), output: z.object({}), errors: ['wrong_status', ...ADJUSTMENT_ERRORS],
});
/** A draft adjustment, thrown away; a pending approval request is closed with it (withdrawPending, RAD-114). */
export const deleteStockAdjustment = defineContract({
  method: 'DELETE', path: '/stock/adjustments/:id', auth: 'session', perm: 'stock:count', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Sends a draft adjustment for approval by someone else (flow 7); nothing posts until then. */
export const requestStockAdjustmentApproval = defineContract({
  method: 'POST', path: '/stock/adjustments/:id/approval', auth: 'session', perm: 'stock:count', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }), errors: ['wrong_status'],
});
/** The adjustment approval routes (RAD-38): approving posts it (F14). */
export const stockAdjustmentApproval = approvalContracts('stock-adjustment', 'stock:approve',
  ['wrong_status', 'serial_elsewhere', ...POSTING_ERRORS]);
/** Cancels a posted adjustment: its mirror, dated the cancellation's day. */
export const cancelStockAdjustment = defineContract({
  method: 'POST', path: '/stock/adjustments/:id/cancel', auth: 'session', perm: 'stock:approve', tx: write,
  input: cancelIn, output: z.object({}), errors: [...CANCEL_ERRORS],
});
