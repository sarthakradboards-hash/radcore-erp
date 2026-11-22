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
  creditNoteLines, creditNotes, deliveries, deliveryLines, deliveryReturnLines, deliveryReturns, invoiceLines, invoices, salesOrderLines,
  salesTx,
} from '@radcore/db/sales';
import { dec, roundMoney, roundQty, type Decimal, type Money, type Quantity } from '@radcore/lib-common';
import { systemPartyId } from '@radcore/lib-accounts';
import type { Ctx } from '@radcore/lib-platform';
import { serialKey } from '@radcore/lib-stock';
import { and, asc, eq, inArray, isNotNull, sum } from 'drizzle-orm';
import { toRupee } from './invoice-rules.ts';

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
 * (ADR-006 §4); and, of the returns and credit notes' goods back, how many of each batch the line was picked from
 * came back, and whether each of its serials did. */
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
  // Goods back on credit notes (RAD-114) came back too, in their batches and serials, though the line stays invoiced.
  const credited = lines.length === 0 ? [] : await salesTx(ctx).select({ line: invoiceLines.deliveryLineId, picks: creditNoteLines.picks })
    .from(creditNoteLines)
    .innerJoin(creditNotes, and(eq(creditNotes.id, creditNoteLines.creditNoteId), eq(creditNotes.status, 'posted')))
    .innerJoin(invoiceLines, eq(invoiceLines.id, creditNoteLines.invoiceLineId))
    .where(and(inArray(invoiceLines.deliveryLineId, ids), isNotNull(creditNoteLines.picks)));
  const back = new Map<string, Returned>();
  for (const line of lines) {
    const mine = rows.filter((r) => r.line === line.id);
    const gone = [...mine, ...billed.filter((r) => r.line === line.id)];
    const total = (f: (r: (typeof gone)[number]) => string | null) => gone.reduce((s, r) => s.plus(dec(f(r) ?? '0')), dec('0'));
    const cameBack = [...mine, ...credited.filter((r) => r.line === line.id)];
    const came = cameBack.flatMap((r) => picksOf(r.picks).batches);
    const cameSerials = new Set(cameBack.flatMap((r) => picksOf(r.picks).serials.map(serialKey)));
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
  return rupeesOf((await notInvoicedLeft(ctx, partyId)).values());
}

/** Each delivery's part to the rupee, as its invoice will round it, summed: so a delivery paid for in advance at its
 * rounded bill leaves nothing over, and one invoiced whole leaves exactly 0 (the architect on RAD-115). */
export const rupeesOf = (values: Iterable<Decimal>): Money => roundMoney([...values].reduce((s, v) => s.plus(dec(toRupee(v))), dec('0')));

/**
 * shortcut: the seeded Counter customer is never left owing (the quick bill takes it paid in full, and it can have no
 * order or delivery of its own: tools/walk-in-owes-nothing.test.ts), so its credit checks skip its whole history, which
 * every counter sale lengthens (RAD-115's save under 2 seconds; the architect's option (a)). A party that can owe still
 * reads all of it; backend's ticket makes that flat for every party, when this goes.
 */
export const counterCustomer = async (ctx: Ctx, partyId: string): Promise<boolean> => partyId === await systemPartyId(ctx, 'walk_in');

/** Each of the party's posted deliveries' value still to invoice, at selling value with GST, unrounded, by delivery. */
export async function notInvoicedLeft(ctx: Ctx, partyId: string): Promise<Map<string, Decimal>> {
  if (await counterCustomer(ctx, partyId)) return new Map();
  const tx = salesTx(ctx);
  const out = await tx.select({ id: deliveries.id, taxable: sum(deliveryLines.taxable), gst: sum(deliveryLines.gst) }).from(deliveryLines)
    .innerJoin(deliveries, and(eq(deliveries.id, deliveryLines.deliveryId), eq(deliveries.status, 'posted'), eq(deliveries.partyId, partyId)))
    .groupBy(deliveries.id);
  const back = await tx.select({ id: deliveryReturns.deliveryId, taxable: sum(deliveryReturnLines.taxable), gst: sum(deliveryReturnLines.gst) })
    .from(deliveryReturnLines).innerJoin(deliveryReturns, and(eq(deliveryReturns.id, deliveryReturnLines.returnId),
      eq(deliveryReturns.status, 'posted'), eq(deliveryReturns.partyId, partyId))).groupBy(deliveryReturns.deliveryId);
  const billed = await tx.select({ id: deliveryLines.deliveryId, taxable: sum(invoiceLines.deliveryTaxable), gst: sum(invoiceLines.deliveryGst) })
    .from(invoiceLines).innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.status, 'posted'), eq(invoices.partyId, partyId)))
    .innerJoin(deliveryLines, eq(deliveryLines.id, invoiceLines.deliveryLineId)).groupBy(deliveryLines.deliveryId);
  const value = (r: { taxable: string | null; gst: string | null }) => dec(r.taxable ?? '0').plus(dec(r.gst ?? '0'));
  const left = new Map(out.map((r) => [r.id, value(r)]));
  for (const r of [...back, ...billed]) left.set(r.id, (left.get(r.id) ?? dec('0')).minus(value(r)));
  return left;
}

/** Locks the deliveries of the caller's delivery lines, FOR UPDATE in id order, answering nothing: an invoice's
 * cancellation holds them so a return or another invoice of them waits for it (ADR-006 §1). */
export async function holdDeliveriesOf(ctx: Ctx, deliveryLineIds: readonly string[]): Promise<void> {
  if (deliveryLineIds.length === 0) return;
  const tx = salesTx(ctx);
  const ids = [...new Set((await tx.select({ id: deliveryLines.deliveryId }).from(deliveryLines)
    .where(inArray(deliveryLines.id, [...deliveryLineIds]))).map((r) => r.id))];
  await tx.select({ id: deliveries.id }).from(deliveries).where(inArray(deliveries.id, ids)).orderBy(asc(deliveries.id)).for('update');
}

/** What standing credit notes have taken off each of the caller's invoice lines (RAD-114, ADR-007 §6): goods back by
 * quantity, and every note's taxable value, tax and the cost of the goods back, for what's left of the line. */
export type Credited = { qty: Quantity; taxable: Money; cgst: Money; sgst: Money; igst: Money; cost: Money };
export async function creditedOf(ctx: Ctx, invoiceLineIds: readonly string[]): Promise<Map<string, Credited>> {
  const rows = invoiceLineIds.length === 0 ? [] : await salesTx(ctx).select({ line: creditNoteLines.invoiceLineId, qty: sum(creditNoteLines.qty),
    taxable: sum(creditNoteLines.taxable), cgst: sum(creditNoteLines.cgst), sgst: sum(creditNoteLines.sgst), igst: sum(creditNoteLines.igst),
    cost: sum(creditNoteLines.cost) }).from(creditNoteLines)
    .innerJoin(creditNotes, and(eq(creditNotes.id, creditNoteLines.creditNoteId), eq(creditNotes.status, 'posted')))
    .where(inArray(creditNoteLines.invoiceLineId, [...invoiceLineIds])).groupBy(creditNoteLines.invoiceLineId);
  const m = (v: string | null) => roundMoney(v ?? '0');
  return new Map(invoiceLineIds.map((id) => {
    const r = rows.find((x) => x.line === id);
    return [id, { qty: asQty(dec(r?.qty ?? '0')), taxable: m(r?.taxable ?? null), cgst: m(r?.cgst ?? null), sgst: m(r?.sgst ?? null),
      igst: m(r?.igst ?? null), cost: m(r?.cost ?? null) }];
  }));
}

/** Whether a standing credit note credits the caller's invoice: it can't be cancelled then (ADR-007 §6). */
export async function hasCreditNotes(ctx: Ctx, invoiceId: string): Promise<boolean> {
  const [row] = await salesTx(ctx).select({ id: creditNotes.id }).from(creditNotes)
    .where(and(eq(creditNotes.invoiceId, invoiceId), eq(creditNotes.status, 'posted'))).limit(1);
  return row !== undefined;
}

/** Each of the caller's order lines' quantity on posted invoices (the architect on RAD-112: an order line's progress,
 * worked out on read): its delivery lines' invoice lines, summed. */
export async function invoicedOf(ctx: Ctx, orderLineIds: readonly string[]): Promise<Map<string, Quantity>> {
  if (orderLineIds.length === 0) return new Map();
  const rows = await salesTx(ctx).select({ line: deliveryLines.orderLineId, qty: sum(invoiceLines.qty) }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.status, 'posted')))
    .innerJoin(deliveryLines, eq(deliveryLines.id, invoiceLines.deliveryLineId))
    .where(inArray(deliveryLines.orderLineId, [...orderLineIds])).groupBy(deliveryLines.orderLineId);
  return new Map(orderLineIds.map((id) => [id, asQty(dec(rows.find((r) => r.line === id)?.qty ?? '0'))]));
}
