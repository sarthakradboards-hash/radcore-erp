// What has been delivered, and taken back, of orders and deliveries (M3-08, RAD-112), read from the posted documents:
// how much of an order line is left to deliver, how much of a delivery line is left to take back (and which batches
// and serials), and what a party has had delivered and not yet invoiced (M3-07's credit exposure). Every document
// counts, whoever made it: these are the business's figures, not a person's list, so this file reads past the record
// scope, and only it (E7's exemption, ADR-001 §6a).
import { deliveries, deliveryLines, deliveryReturnLines, deliveryReturns, salesOrderLines, salesTx } from '@radcore/db/sales';
import { dec, roundMoney, type Decimal, type Money, type Quantity } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { serialKey } from '@radcore/lib-stock';
import { and, eq, inArray, sum } from 'drizzle-orm';

/** A line's picks as the draft holds them (contract/deliveries.ts's `picks`). */
export type Picks = { batches: { batchId: string | null; qty: Quantity }[]; serials: string[] };
export const picksOf = (v: unknown): Picks => v as Picks;

/** Each order line's quantity delivered, net of what's been taken back. */
export async function netDelivered(ctx: Ctx, orderLineIds: readonly string[]): Promise<Map<string, Decimal>> {
  const net = new Map<string, Decimal>();
  if (orderLineIds.length === 0) return net;
  const tx = salesTx(ctx);
  const out = await tx.select({ line: deliveryLines.orderLineId, qty: sum(deliveryLines.qty) }).from(deliveryLines)
    .innerJoin(deliveries, and(eq(deliveries.id, deliveryLines.deliveryId), eq(deliveries.status, 'posted')))
    .where(inArray(deliveryLines.orderLineId, [...orderLineIds])).groupBy(deliveryLines.orderLineId);
  const back = await tx.select({ line: deliveryLines.orderLineId, qty: sum(deliveryReturnLines.qty) }).from(deliveryReturnLines)
    .innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId), eq(deliveryReturns.status, 'posted')))
    .innerJoin(deliveryLines, eq(deliveryLines.id, deliveryReturnLines.deliveryLineId))
    .where(inArray(deliveryLines.orderLineId, [...orderLineIds])).groupBy(deliveryLines.orderLineId);
  for (const r of out) net.set(r.line, dec(r.qty ?? '0'));
  for (const r of back) net.set(r.line, (net.get(r.line) ?? dec('0')).minus(dec(r.qty ?? '0')));
  return net;
}

/** Whether any of an order has gone (net of returns), and whether all of it has: what closing and cancelling it ask. */
export async function orderDelivered(ctx: Ctx, orderId: string): Promise<{ any: boolean; all: boolean }> {
  const lines = await salesTx(ctx).select({ id: salesOrderLines.id, qty: salesOrderLines.qty }).from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId));
  const net = await netDelivered(ctx, lines.map((l) => l.id));
  const gone = lines.map((l) => [net.get(l.id) ?? dec('0'), dec(l.qty)] as const);
  return { any: gone.some(([n]) => n.gt(0)), all: lines.length > 0 && gone.every(([n, q]) => n.gte(q)) };
}

/** Whether an order has any delivery, draft or posted: its lines are then fixed, since a delivery names them. */
export async function hasDeliveries(ctx: Ctx, orderId: string): Promise<boolean> {
  const [row] = await salesTx(ctx).select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.orderId, orderId)).limit(1);
  return row !== undefined;
}

/** Whether a delivery has any return, draft or posted: a draft delivery is never returned, so this is a posted one's. */
export async function hasReturns(ctx: Ctx, deliveryId: string): Promise<boolean> {
  const [row] = await salesTx(ctx).select({ id: deliveryReturns.id }).from(deliveryReturns)
    .where(eq(deliveryReturns.deliveryId, deliveryId)).limit(1);
  return row !== undefined;
}

/** What has come back of each delivery line on posted returns: its quantity, its share of the line's figures, and the
 * batches and serials it came back with. */
export type Returned = { qty: Decimal; value: Decimal; taxable: Decimal; gst: Decimal; batches: Map<string, Decimal>; serials: Set<string> };
/** A picked batch's key in `Returned.batches`: its id, or 'unknown' for "batch unknown". */
export const pickedBatchKey = (id: string | null): string => id ?? 'unknown';
export const nothingBack = (): Returned =>
  ({ qty: dec('0'), value: dec('0'), taxable: dec('0'), gst: dec('0'), batches: new Map<string, Decimal>(), serials: new Set<string>() });

export async function returnedOf(ctx: Ctx, deliveryLineIds: readonly string[]): Promise<Map<string, Returned>> {
  const back = new Map<string, Returned>();
  if (deliveryLineIds.length === 0) return back;
  const rows = await salesTx(ctx).select({ line: deliveryReturnLines.deliveryLineId, qty: deliveryReturnLines.qty,
    value: deliveryReturnLines.value, taxable: deliveryReturnLines.taxable, gst: deliveryReturnLines.gst, picks: deliveryReturnLines.picks })
    .from(deliveryReturnLines)
    .innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId), eq(deliveryReturns.status, 'posted')))
    .where(inArray(deliveryReturnLines.deliveryLineId, [...deliveryLineIds]));
  for (const r of rows) {
    const b = back.get(r.line) ?? nothingBack();
    const picks = picksOf(r.picks);
    b.qty = b.qty.plus(dec(r.qty));
    b.value = b.value.plus(dec(r.value ?? '0'));
    b.taxable = b.taxable.plus(dec(r.taxable ?? '0'));
    b.gst = b.gst.plus(dec(r.gst ?? '0'));
    for (const p of picks.batches) b.batches.set(pickedBatchKey(p.batchId), (b.batches.get(pickedBatchKey(p.batchId)) ?? dec('0')).plus(dec(p.qty)));
    for (const s of picks.serials) b.serials.add(serialKey(s));
    back.set(r.line, b);
  }
  return back;
}

/**
 * What a party has been delivered and not yet invoiced, at its selling value with GST (M3-07's credit exposure, counted
 * once): its posted deliveries' lines less what's been taken back.
 * shortcut: no invoice bills a delivery until M3-09 (RAD-113), which takes what it bills off here too.
 */
export async function deliveredNotInvoiced(ctx: Ctx, partyId: string): Promise<Money> {
  const tx = salesTx(ctx);
  const [out] = await tx.select({ taxable: sum(deliveryLines.taxable), gst: sum(deliveryLines.gst) }).from(deliveryLines)
    .innerJoin(deliveries, and(eq(deliveries.id, deliveryLines.deliveryId), eq(deliveries.status, 'posted'), eq(deliveries.partyId, partyId)));
  const [back] = await tx.select({ taxable: sum(deliveryReturnLines.taxable), gst: sum(deliveryReturnLines.gst) }).from(deliveryReturnLines)
    .innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId), eq(deliveryReturns.status, 'posted'),
      eq(deliveryReturns.partyId, partyId)));
  const total = (r: { taxable: string | null; gst: string | null } | undefined) => dec(r?.taxable ?? '0').plus(dec(r?.gst ?? '0'));
  return roundMoney(total(out).minus(total(back)));
}
