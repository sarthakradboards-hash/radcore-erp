// What has been delivered, taken back and invoiced, of orders and deliveries (M3-08, M3-09; RAD-112, RAD-113), read from
// the posted documents: how much of an order line is left to deliver, how much of a delivery line is still out to take
// back or invoice (of which batches and serials), and what a party has had delivered and not yet invoiced (M3-07's
// credit exposure). Every document counts,
// whoever made it, as the answers are about the order or party, not a person: so this file reads past the record scope,
// and is E7's one exemption (the architect on RAD-112, ADR-001 §6a). Its rules:
// - each export answers only aggregates (Money, Quantity, boolean), keyed by ids, batches and serials its caller passed
//   in, never another document's row, id or field: the return types below say so;
// - the caller has already applied ctx.see to the order, delivery or party it asks about.
import {
  deliveries, deliveryLines, deliveryReturnLines, deliveryReturns, invoiceLines, invoices, salesOrderLines, salesTx,
} from '@radcore/db/sales';
import { dec, roundMoney, roundQty, type Decimal, type Money, type Quantity } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { serialKey } from '@radcore/lib-stock';
import { and, eq, inArray, sum } from 'drizzle-orm';

const QTY_PLACES = 3; // a line's quantity column, numeric(18, 3)
const asQty = (d: Decimal): Quantity => roundQty(d, QTY_PLACES);

/** A line's picks as the draft holds them (contract/deliveries.ts's `picks`). */
export type Picks = { batches: { batchId: string | null; qty: Quantity }[]; serials: string[] };
export const picksOf = (v: unknown): Picks => v as Picks;

/** Each of the caller's order lines' quantity delivered, net of what's been taken back. */
export async function netDelivered(ctx: Ctx, orderLineIds: readonly string[]): Promise<Map<string, Quantity>> {
  const net = new Map<string, Decimal>();
  if (orderLineIds.length === 0) return new Map();
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
  return new Map([...net].map(([line, q]) => [line, asQty(q)]));
}

/** Whether any of an order has gone (net of returns), and whether all of it has: what closing and cancelling it ask. */
export async function orderDelivered(ctx: Ctx, orderId: string): Promise<{ any: boolean; all: boolean }> {
  const lines = await salesTx(ctx).select({ id: salesOrderLines.id, qty: salesOrderLines.qty }).from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId));
  const net = await netDelivered(ctx, lines.map((l) => l.id));
  const gone = lines.map((l) => [dec(net.get(l.id) ?? '0'), dec(l.qty)] as const);
  return { any: gone.some(([n]) => n.gt(0)), all: lines.length > 0 && gone.every(([n, q]) => n.gte(q)) };
}

/** Whether an order has any delivery, draft or posted: its lines are then fixed, since a delivery names them. */
export async function hasDeliveries(ctx: Ctx, orderId: string): Promise<boolean> {
  const [row] = await salesTx(ctx).select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.orderId, orderId)).limit(1);
  return row !== undefined;
}

/** What has gone from one of the caller's delivery lines, on posted returns and posted invoices together: how many, and
 * their shares of the line's cost, taxable value and GST, so whichever takes the last of it clears what's left
 * (ADR-006 §4); and, of the returns alone, how many of each batch the line was picked from came back, and whether
 * each of its serials did. */
export type Returned = { qty: Quantity; value: Money; taxable: Money; gst: Money; batches: ReadonlyMap<string, Quantity>;
  serials: ReadonlyMap<string, boolean> };
/** A picked batch's key in `Returned.batches`: its id, or 'unknown' for "batch unknown". */
export const pickedBatchKey = (id: string | null): string => id ?? 'unknown';

/** What has gone from each of the caller's delivery lines, by the line's id: answered only for the batches and serials
 * the line itself was picked with, so nothing of the returns or invoices themselves leaves here. */
export async function returnedOf(ctx: Ctx, lines: readonly { id: string; picks: unknown }[]): Promise<Map<string, Returned>> {
  const ids = lines.map((l) => l.id);
  const rows = lines.length === 0 ? [] : await salesTx(ctx).select({ line: deliveryReturnLines.deliveryLineId, qty: deliveryReturnLines.qty,
    value: deliveryReturnLines.value, taxable: deliveryReturnLines.taxable, gst: deliveryReturnLines.gst, picks: deliveryReturnLines.picks })
    .from(deliveryReturnLines)
    .innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId), eq(deliveryReturns.status, 'posted')))
    .where(inArray(deliveryReturnLines.deliveryLineId, ids));
  const billed = lines.length === 0 ? [] : await salesTx(ctx).select({ line: invoiceLines.deliveryLineId, qty: invoiceLines.qty,
    value: invoiceLines.cost, taxable: invoiceLines.deliveryTaxable, gst: invoiceLines.deliveryGst }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.status, 'posted')))
    .where(inArray(invoiceLines.deliveryLineId, ids));
  const back = new Map<string, Returned>();
  for (const line of lines) {
    const mine = rows.filter((r) => r.line === line.id);
    const gone = [...mine, ...billed.filter((r) => r.line === line.id)];
    const total = (f: (r: (typeof gone)[number]) => string | null) => gone.reduce((s, r) => s.plus(dec(f(r) ?? '0')), dec('0'));
    const came = mine.flatMap((r) => picksOf(r.picks).batches);
    const cameSerials = new Set(mine.flatMap((r) => picksOf(r.picks).serials.map(serialKey)));
    const picked = picksOf(line.picks);
    back.set(line.id, {
      qty: asQty(total((r) => r.qty)), value: roundMoney(total((r) => r.value)), taxable: roundMoney(total((r) => r.taxable)),
      gst: roundMoney(total((r) => r.gst)),
      batches: new Map(picked.batches.map((p) => [pickedBatchKey(p.batchId), asQty(came.filter((c) => c.batchId === p.batchId)
        .reduce((s, c) => s.plus(dec(c.qty)), dec('0')))])),
      serials: new Map(picked.serials.map((x) => [serialKey(x), cameSerials.has(serialKey(x))])),
    });
  }
  return back;
}

/**
 * What a party has been delivered and not yet invoiced, at its selling value with GST (M3-07's credit exposure, counted
 * once): its posted deliveries' lines less what's been taken back and what's been invoiced.
 */
export async function deliveredNotInvoiced(ctx: Ctx, partyId: string): Promise<Money> {
  const tx = salesTx(ctx);
  const [out] = await tx.select({ taxable: sum(deliveryLines.taxable), gst: sum(deliveryLines.gst) }).from(deliveryLines)
    .innerJoin(deliveries, and(eq(deliveries.id, deliveryLines.deliveryId), eq(deliveries.status, 'posted'), eq(deliveries.partyId, partyId)));
  const [back] = await tx.select({ taxable: sum(deliveryReturnLines.taxable), gst: sum(deliveryReturnLines.gst) }).from(deliveryReturnLines)
    .innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId), eq(deliveryReturns.status, 'posted'),
      eq(deliveryReturns.partyId, partyId)));
  const [billed] = await tx.select({ taxable: sum(invoiceLines.deliveryTaxable), gst: sum(invoiceLines.deliveryGst) }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.status, 'posted'), eq(invoices.partyId, partyId)));
  const total = (r: { taxable: string | null; gst: string | null } | undefined) => dec(r?.taxable ?? '0').plus(dec(r?.gst ?? '0'));
  return roundMoney(total(out).minus(total(back)).minus(total(billed)));
}
