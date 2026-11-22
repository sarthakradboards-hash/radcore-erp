// The quick bills held for an approval (RAD-115, RC-190's hold and recall; the architect's ruling): a list a cashier
// comes back to, or another at the till picks up. At the order's scope, as completing one is, so it never offers a bill
// the reader can't finish. A rejected or abandoned hold is thrown away by deleting its draft order (DELETE
// /sales/orders/:id), which takes its hold with it.
import { after, quickBillHolds, salesOrderLines, salesOrders, salesTx } from '@radcore/db/sales';
import { roundMoney } from '@radcore/lib-common';
import { awaitingApproval, decodeCursor, encodeCursor, isoMoment, listScope, momentKey, principalsOf, type Ctx } from '@radcore/lib-platform';
import { and, asc, count, inArray, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { listHeldQuickBills } from '../contract.ts';
import { orderOverride } from './order-checks.ts';
import { partyNames } from './party-names.ts';
import type { PlannedPayment } from './quick-bill-holds.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const PAGE_KEY = z.object({ at: momentKey(), id: z.uuid() });

/** GET /sales/quick-bills/held (invoices:write): oldest first, a page at a time, the reader's own at `own` scope. */
export async function heldBillsPage(ctx: Ctx, input: In<typeof listHeldQuickBills>): Promise<Out<typeof listHeldQuickBills>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select({ orderId: quickBillHolds.orderId, payments: quickBillHolds.payments, at: quickBillHolds.createdAt,
    by: quickBillHolds.createdBy, partyId: salesOrders.partyId, approved: salesOrders.overrideVersion })
    .from(quickBillHolds).innerJoin(salesOrders, eq(salesOrders.id, quickBillHolds.orderId)).where(and(
      listScope(ctx, 'invoices:write', salesOrders.createdBy),
      after([quickBillHolds.createdAt, quickBillHolds.orderId], key && [key.at, key.id], 'asc'),
    )).orderBy(asc(quickBillHolds.createdAt), asc(quickBillHolds.orderId)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const ids = page.map((r) => r.orderId);
  const counts = new Map(ids.length === 0 ? [] : (await salesTx(ctx).select({ id: salesOrderLines.orderId, n: count() }).from(salesOrderLines)
    .where(inArray(salesOrderLines.orderId, ids)).groupBy(salesOrderLines.orderId)).map((c) => [c.id, c.n]));
  const waiting = await awaitingApproval(ctx, orderOverride, ids);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const who = await principalsOf(ctx, page.map((r) => r.by));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ orderId: r.orderId, partyId: r.partyId, partyName: names.get(r.partyId) ?? '', items: counts.get(r.orderId) ?? 0,
      // Each planned payment's method and amount, never its reference (no card or bank detail on a list).
      payments: (r.payments as PlannedPayment[]).map((p) => ({ method: p.method, amount: roundMoney(p.amount) })),
      // A held bill always asked: waiting while its request is, approved once its order carries the approval, else
      // turned down (rejected, or gone stale and not asked again).
      approval: waiting.has(r.orderId) ? 'waiting' as const : r.approved !== null ? 'approved' as const : 'rejected' as const,
      heldBy: who(r.by), heldAt: isoMoment(r.at) })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.at, id: last.orderId }) : null,
  };
}
