// A held quick bill's row (M3-11, RAD-115; the architect's ruling on "hold, then complete"), read by the order's checks
// and by the quick bill. Whose it is follows its order's scope, read first by the caller.
import { quickBillHolds, salesTx } from '@radcore/db/sales';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';

/** A payment planned at hold: its method and amount, and a bank payment's account. No card code: it isn't charged yet. */
export type PlannedPayment = { method: 'cash' | 'card' | 'bank'; amount: string; accountId?: string; reference?: string };
/** Each order line's batches and serials, by its line number. */
type HeldPicks = { lineNo: number; batches: { batchId: string | null; qty: string }[]; serials: string[] }[];
export type Hold = { orderId: string; locationId: string; payments: PlannedPayment[]; picks: HeldPicks; approvedAfter: string | null };

/** The order's hold, or null when it isn't one; locked when it's to be completed. */
export async function holdOf(ctx: Ctx, orderId: string, forUpdate = false): Promise<Hold | null> {
  const q = salesTx(ctx).select().from(quickBillHolds).where(eq(quickBillHolds.orderId, orderId));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row === undefined ? null : { orderId: row.orderId, locationId: row.locationId, payments: row.payments as PlannedPayment[],
    picks: row.picks as HeldPicks, approvedAfter: row.approvedAfter };
}

/** Records what the party would owe, as its override is approved (order-checks' approved()). */
export async function setApprovedAfter(ctx: Ctx, orderId: string, after: string): Promise<void> {
  await salesTx(ctx).update(quickBillHolds).set({ approvedAfter: after }).where(eq(quickBillHolds.orderId, orderId));
}

/** What a held order's planned payments come to: what its override's check takes off the exposure (`paidNow`). */
export async function heldPaid(ctx: Ctx, orderId: string): Promise<Money | null> {
  const hold = await holdOf(ctx, orderId);
  return hold === null ? null : roundMoney(hold.payments.reduce((s, p) => s.plus(dec(p.amount)), dec('0')));
}
