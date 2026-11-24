// Job Work Charges to be Billed by job-work receipt line, for the books check (RAD-95; ADR-006 §7): what each posted
// receipt line's charge accrued. Every receipt counts, whoever made it, so this file reads past the record scope: E7's
// exemption, by the architect's ruling on RAD-95 (ADR-001 §6a). Its rules, checked in review:
// - it answers only money keyed by job-work receipt-line id: never a name, rate, quantity, document id or maker;
// - only the books check calls it, under journal:read.
// As at a date, a receipt counts from its own business date until its cancellation entry's date.
import { jobWorkReceiptLines, jobWorkReceipts, stockTx } from '@radcore/db/stock';
import { entryDates } from '@radcore/lib-accounts';
import { roundMoney, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { eq, inArray } from 'drizzle-orm';

/** Each posted job-work receipt line's charge, as at `asAt` (now when it's left out); a line that made nothing is left out. */
export async function jobWorkChargesByLine(ctx: Ctx, asAt?: string): Promise<{ jobWorkLineId: string; charge: Money }[]> {
  const rows = await stockTx(ctx).select({ line: jobWorkReceiptLines.id, charge: jobWorkReceiptLines.charge, date: jobWorkReceipts.businessDate,
    cancelEntryId: jobWorkReceipts.cancelEntryId, status: jobWorkReceipts.status })
    .from(jobWorkReceiptLines).innerJoin(jobWorkReceipts, eq(jobWorkReceipts.id, jobWorkReceiptLines.receiptId))
    .where(inArray(jobWorkReceipts.status, ['posted', 'cancelled']));
  const dates = await entryDates(ctx, rows.flatMap((r) => (r.cancelEntryId === null ? [] : [r.cancelEntryId])));
  // Posted by the date, and not cancelled by then. A cancelled receipt with no entry carried no value.
  return rows.filter((r) => r.charge !== null && (asAt === undefined || r.date <= asAt) && (r.status !== 'cancelled' || (asAt !== undefined
    && r.cancelEntryId !== null && (dates.get(r.cancelEntryId) ?? '') > asAt)))
    .map((r) => ({ jobWorkLineId: r.line, charge: roundMoney(r.charge ?? '0') }));
}
