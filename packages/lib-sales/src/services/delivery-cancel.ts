// Cancelling a posted delivery or delivery return (M3-10, RAD-114; ADR-007 §6; ADR-006 §4, §6), under deliveries:cancel
// (the architect's ruling). Its stock is mirrored through the stock engine, at the values it moved at, in the same
// batches, with its units moved back (reverseStock), and its entries through lib-accounts, its own and any revaluation
// (reverseEntriesOf), each dated the cancellation's day. Nothing is deleted.
// - A delivery is cancelled only while nothing on it is invoiced or taken back: those are cancelled first. An order its
//   deliveries closed opens again, as a return reopens one.
// - A return's goods go back out to the customer, on the same delivery lines; they must still be at the place, and the
//   order line mustn't go over what was ordered. An order every line of which has gone again closes again.
import {
  deliveries, deliveryLines, deliveryReturnLines, deliveryReturns, salesOrderLines, salesOrders, salesTx,
} from '@radcore/db/sales';
import { holdPeriod, reverseEntriesOf } from '@radcore/lib-accounts';
import { dec } from '@radcore/lib-common';
import { AppError, principalId, type Ctx } from '@radcore/lib-platform';
import { reverseStock } from '@radcore/lib-stock';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { cancelDelivery, cancelDeliveryReturn } from '../contract.ts';
import { deliveryOf } from './deliveries.ts';
import { netDelivered, orderDelivered, returnedOf } from './delivered.ts';
import { returnOf } from './delivery-returns.ts';
import { checkDate } from './document-rules.ts';
import { today } from './document-lines.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const cancelled = (ctx: Ctx, reason: string, cancelEntryId: string | undefined) => {
  if (cancelEntryId === undefined) throw new Error('a posted document has an entry to reverse');
  return { status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal), cancelReason: reason, cancelEntryId };
};

/** The order, locked after its delivery (ADR-006 §1), within the principal's sight (sales:read). */
async function lockedOrder(ctx: Ctx, orderId: string) {
  const [order] = await salesTx(ctx).select({ status: salesOrders.status, closeReason: salesOrders.closeReason, owner: salesOrders.createdBy })
    .from(salesOrders).where(eq(salesOrders.id, orderId)).for('update');
  if (order === undefined) throw new Error(`order ${orderId} is gone`);
  ctx.see('sales:read', { owner: order.owner });
  return order;
}

/** An order its deliveries closed (no reason) opens again when a line is back below what was ordered, and closes
 * again when every line has gone; one a person closed short stays as it is (ADR-007 §1). */
async function settleOrder(ctx: Ctx, orderId: string, order: { status: string; closeReason: string | null }) {
  if (order.closeReason !== null || (order.status !== 'closed' && order.status !== 'confirmed')) return;
  const { all } = await orderDelivered(ctx, orderId);
  const status = all ? 'closed' : 'confirmed';
  if (status !== order.status) await salesTx(ctx).update(salesOrders).set({ status }).where(eq(salesOrders.id, orderId));
}

/** POST /sales/deliveries/:id/cancel (deliveries:cancel). The period, the delivery, its order, then the stock engine's. */
export async function cancelDeliveryNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelDelivery>): Promise<Out<typeof cancelDelivery>> {
  await holdPeriod(ctx, businessDate);
  const d = await deliveryOf(ctx, id, 'deliveries:cancel', true);
  if (d.status !== 'posted') throw new AppError('wrong_status', `This delivery is ${d.status}, so it can’t be cancelled`);
  checkDate(businessDate, today(), { date: d.businessDate, what: 'delivery' });
  const order = await lockedOrder(ctx, d.orderId);
  const tx = salesTx(ctx);
  const lines = await tx.select({ id: deliveryLines.id, picks: deliveryLines.picks }).from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
  if ([...(await returnedOf(ctx, lines)).values()].some((g) => dec(g.qty).gt(0))) {
    throw new AppError('delivery_in_use', 'Goods on this delivery have been invoiced or taken back: cancel those first');
  }
  await reverseStock(ctx, { sourceTable: 'deliveries', sourceId: id, businessDate });
  const [own] = await reverseEntriesOf(ctx, { source: { table: 'deliveries', id }, businessDate, reason });
  await tx.update(deliveries).set(cancelled(ctx, reason, own?.id)).where(eq(deliveries.id, id));
  await settleOrder(ctx, d.orderId, order);
  return {};
}

/** POST /sales/delivery-returns/:id/cancel (deliveries:cancel). The period, the return, its delivery, the order, then
 * the stock engine's: the goods go back out to the customer at the values they came back at (RC-207). */
export async function cancelDeliveryReturnNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelDeliveryReturn>):
  Promise<Out<typeof cancelDeliveryReturn>> {
  await holdPeriod(ctx, businessDate);
  const r = await returnOf(ctx, id, 'deliveries:cancel', true);
  if (r.status !== 'posted') throw new AppError('wrong_status', `This return is ${r.status}, so it can’t be cancelled`);
  checkDate(businessDate, today(), { date: r.businessDate, what: 'return' });
  const tx = salesTx(ctx);
  const [delivery] = await tx.select({ orderId: deliveries.orderId, owner: deliveries.owner }).from(deliveries)
    .where(eq(deliveries.id, r.deliveryId)).for('update');
  if (delivery === undefined) throw new Error(`delivery ${r.deliveryId} is gone`);
  ctx.see('deliveries:cancel', { owner: delivery.owner });
  const order = await lockedOrder(ctx, delivery.orderId);
  // Going out again mustn't take an order line past what was ordered: a later delivery may have sent it since.
  const back = await tx.select({ orderLineId: deliveryLines.orderLineId, qty: deliveryReturnLines.qty, ordered: salesOrderLines.qty })
    .from(deliveryReturnLines).innerJoin(deliveryLines, eq(deliveryLines.id, deliveryReturnLines.deliveryLineId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId)).where(eq(deliveryReturnLines.returnId, id));
  const gone = await netDelivered(ctx, back.map((b) => b.orderLineId));
  for (const [n, b] of back.entries()) {
    if (dec(gone.get(b.orderLineId) ?? '0').plus(dec(b.qty)).gt(dec(b.ordered))) {
      throw new AppError('over_quantity', 'The order has been delivered again since: this would send more than was ordered',
        [{ path: ['lines', n], code: 'over_quantity', message: 'Cancel the later delivery first' }]);
    }
  }
  await reverseStock(ctx, { sourceTable: 'delivery_returns', sourceId: id, businessDate });
  const [own] = await reverseEntriesOf(ctx, { source: { table: 'delivery_returns', id }, businessDate, reason });
  await tx.update(deliveryReturns).set(cancelled(ctx, reason, own?.id)).where(eq(deliveryReturns.id, id));
  await settleOrder(ctx, delivery.orderId, order);
  return {};
}
