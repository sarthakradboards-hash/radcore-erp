// A job worker's bill (ADR-008 §7, §11; RAD-142, the architect's sketch): each charge line names the job-work receipt
// line whose made goods it bills, and clears what that receipt's charge accrued to Job Work Charges to be Billed, as a
// goods line clears Goods Received Not Billed: a line taking a receipt line from b0 to b1 of the q it made, whose charge
// was v, clears round(v × b1 / q) − round(v × b0 / q). Its price difference goes to the made item by ADR-006 §4.
import { dec, roundMoney, type Decimal } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';
import type { Ctx } from '@radcore/lib-platform';
import type { purchaseBillLines } from '@radcore/db/purchasing';
import type { JobWorkLine, Row } from './bill-checks.ts';
import { billedCharges } from './billed.ts';

type Line = typeof purchaseBillLines.$inferSelect;
export type Accrual = { line: Line; n: number; itemId: string; rejectsLocationId: string; accepted: Decimal; rejected: Decimal; value: Decimal;
  jobWork: boolean };
const refuse = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

/** A share of what a source line accrued, for billing it from `from` to `to` of its `qty`: telescoping, so the last bill
 * clears exactly what's left. */
export const accrued = (value: string, qty: Decimal, from: Decimal, to: Decimal): Decimal =>
  (qty.isZero() ? dec('0') : dec(roundMoney(dec(value).times(to).div(qty))).minus(dec(roundMoney(dec(value).times(from).div(qty)))));

/** Each charge line, under the locks: its receipt line dated on or before the bill, and billed no further than it made. */
export async function jobWorkAccruals(ctx: Ctx, b: Row, lines: readonly Line[], made: ReadonlyMap<string, JobWorkLine>): Promise<Accrual[]> {
  const used = await billedCharges(ctx, lines.flatMap((l) => (l.jobWorkReceiptLineId === null ? [] : [l.jobWorkReceiptLineId])));
  const out: Accrual[] = [];
  for (const [n, line] of lines.entries()) {
    const r = line.jobWorkReceiptLineId === null ? undefined : made.get(line.jobWorkReceiptLineId);
    if (line.kind !== 'job_work' || r?.madeItemId == null) continue;
    if (b.businessDate < r.receiptDate) throw refuse('date_before_source', `Job-work receipt ${r.receiptNumber ?? ''} is dated ${r.receiptDate}`, ['businessDate']);
    const qty = dec(line.qty ?? '0');
    const before = used.get(r.id) ?? dec('0');
    const madeQty = dec(r.madeQty ?? '0');
    if (before.plus(qty).gt(madeQty)) {
      throw refuse('over_received', `Only ${madeQty.minus(before).toFixed()} of that job-work receipt line is left to bill`, ['lines', n, 'qty']);
    }
    used.set(r.id, before.plus(qty));
    out.push({ line, n, itemId: r.madeItemId, rejectsLocationId: '', accepted: qty, rejected: dec('0'),
      value: accrued(r.charge ?? '0', madeQty, before, before.plus(qty)), jobWork: true });
  }
  return out;
}
