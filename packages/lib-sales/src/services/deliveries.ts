// Deliveries (M3-08, RAD-112; ADR-007 §1–§4, §9; ADR-006 §4–§6, F5): an order's goods out of one place, the person
// naming the batches they picked and each serialised unit. A draft is changed freely and thrown away freely. Posting
// runs the party's credit check again (M3-07, at 'deliver'), takes the goods out at the place's average (the stock
// engine, which writes each unit's `delivered` event), parks their cost in Goods Delivered Not Invoiced (entry
// `delivery`: Dr GDNI, Cr Stock in Hand by item and place), and draws its number (DC) last. An order every line of
// which has gone is closed. Only cancelling (M3-10, RAD-114) changes a posted one.
import { after, deliveries, deliveryLines, salesOrderLines, salesOrders, salesTx } from '@radcore/db/sales';
import { holdParty, holdPeriod, postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, roundQty, type Quantity } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, listScope, momentKey, nextNumber, requestApproval, type Ctx,
} from '@radcore/lib-platform';
import { checkPlace, checkQuantity, postStock } from '@radcore/lib-stock';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  createDelivery, deleteDelivery, getDelivery, listDeliveries, listToInvoice, postDelivery, requestDeliveryOverride, updateDelivery,
} from '../contract.ts';
import { netDelivered, orderDelivered, picksOf, returnedOf } from './delivered.ts';
import { bookingsDelivered, linesDone, lockLiveBookings } from './booking-holds.ts';
import { checkDelivery, deliveryLinesOf, deliveryOverride, pricedLines } from './delivery-checks.ts';
import { checkDate } from './document-rules.ts';
import { labelled, numberedBatches, today } from './document-lines.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type LineIn = In<typeof createDelivery>['lines'][number];
type Status = 'draft' | 'posted' | 'cancelled';

/** Deliveries' numbers (ADR-007 §3): DC/26-27/00001, drawn when a delivery posts. */
export const DELIVERY_SERIES = defineSeries('sales.delivery', 'DC', { digits: 5, label: 'Delivery challans' });

const header = { id: deliveries.id, number: deliveries.number, orderId: deliveries.orderId, partyId: deliveries.partyId,
  locationId: deliveries.locationId, businessDate: deliveries.businessDate, status: deliveries.status, notes: deliveries.notes };
// Newest first: by date, then the moment each was made, then id (e2e-2: same-day ones were in id order, so random).
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const q = (s: string) => quantityString().parse(s);
const wrongStatus = (status: string) => new AppError('wrong_status', `This delivery is ${status}, so it can’t be changed`);

/** The delivery, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
export async function deliveryOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = salesTx(ctx).select({ ...header, owner: deliveries.owner, createdBy: deliveries.createdBy,
    overrideVersion: deliveries.overrideVersion }).from(deliveries).where(eq(deliveries.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such delivery');
  // Its order's owner's, whoever made it (ADR-007 §1).
  ctx.see(permission, { owner: row.owner });
  return row;
}

/** The order a delivery is against: one the principal may see (sales:read), and confirmed. Locked as a delivery posts,
 * so two deliveries of one order take turns over what's left of it. */
async function orderFor(ctx: Ctx, orderId: string, forUpdate = false) {
  const sel = salesTx(ctx).select({ id: salesOrders.id, partyId: salesOrders.partyId, businessDate: salesOrders.businessDate,
    status: salesOrders.status, owner: salesOrders.createdBy }).from(salesOrders).where(eq(salesOrders.id, orderId));
  const [order] = forUpdate ? await sel.for('update') : await sel;
  if (order === undefined) {
    throw new AppError('not_found', 'There is no such order', [{ path: ['orderId'], code: 'unknown', message: 'Choose an order' }]);
  }
  ctx.see('sales:read', { owner: order.owner });
  if (order.status !== 'confirmed') throw new AppError('wrong_status', `This order is ${order.status}: only a confirmed order is delivered`);
  return order;
}

/**
 * A delivery's lines against its order: each names one of the order's lines (`not_on_source`), in a quantity its item's
 * unit allows, and no more than is left of it to deliver, net of what's gone and come back (`over_quantity`).
 */
async function checkedLines(ctx: Ctx, orderId: string, lines: readonly LineIn[]) {
  const ordered = new Map((await salesTx(ctx).select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId, qty: salesOrderLines.qty })
    .from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId))).map((l) => [l.id, l]));
  const gone = await netDelivered(ctx, [...ordered.keys()]);
  const asked = new Map<string, ReturnType<typeof dec>>();
  const rows = [];
  for (const [n, l] of lines.entries()) {
    const line = ordered.get(l.orderLineId);
    if (line === undefined) {
      throw new AppError('not_on_source', 'A line isn’t on this order', [{ path: ['lines', n, 'orderLineId'], code: 'not_on_source', message: 'Choose one of the order’s lines' }]);
    }
    await checkQuantity(ctx, line.itemId, l.qty).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
    });
    const total = (asked.get(line.id) ?? dec('0')).plus(dec(l.qty));
    asked.set(line.id, total);
    const left = dec(line.qty).minus(dec(gone.get(line.id) ?? '0'));
    if (total.gt(left)) {
      throw new AppError('over_quantity', 'That’s more than is left of the order to deliver',
        [{ path: ['lines', n, 'qty'], code: 'over_quantity', message: `${left.toFixed()} left to deliver` }]);
    }
    rows.push({ lineNo: n + 1, orderLineId: line.id, itemId: line.itemId, qty: l.qty, picks: { batches: l.batches, serials: l.serials } });
  }
  return rows;
}

/** GET /sales/deliveries (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listDeliveriesPage(ctx: Ctx, input: In<typeof listDeliveries>): Promise<Out<typeof listDeliveries>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select({ ...header, createdAt: deliveries.createdAt }).from(deliveries).where(and(
    input.filter.status === undefined ? undefined : eq(deliveries.status, input.filter.status),
    input.filter.partyId === undefined ? undefined : eq(deliveries.partyId, input.filter.partyId),
    input.filter.orderId === undefined ? undefined : eq(deliveries.orderId, input.filter.orderId),
    listScope(ctx, 'sales:read', deliveries.owner),
    after([deliveries.businessDate, deliveries.createdAt, deliveries.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(deliveries.businessDate), desc(deliveries.createdAt), desc(deliveries.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /sales/deliveries/:id (sales:read). */
export async function getDeliveryById(ctx: Ctx, { id }: In<typeof getDelivery>): Promise<Out<typeof getDelivery>> {
  // The maker and override version go too, and the contract's answer leaves them out.
  const d = await deliveryOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select({ id: deliveryLines.id, lineNo: deliveryLines.lineNo, orderLineId: deliveryLines.orderLineId,
    itemId: deliveryLines.itemId, qty: deliveryLines.qty, picks: deliveryLines.picks, value: deliveryLines.value, taxable: deliveryLines.taxable,
    gst: deliveryLines.gst }).from(deliveryLines).where(eq(deliveryLines.deliveryId, id)).orderBy(asc(deliveryLines.lineNo));
  const names = await partyNames(ctx, [d.partyId]);
  const left = await leftToInvoice(ctx, lines, d.status === 'posted');
  return { ...d, status: d.status as Status, partyName: names.get(d.partyId) ?? '',
    lines: await numberedBatches(ctx, (await labelled(ctx, lines)).map(({ picks, ...l }) => ({ ...l, ...picksOf(picks),
      qtyToInvoice: left.get(l.id) ?? '0' }))) };
}

/** How much of each posted delivery line is still to invoice (auditor-3 on #285), worked out on read: what went, less
 * what came back and what posted invoices billed (returnedOf counts both). A draft has nothing to invoice yet. */
async function leftToInvoice(ctx: Ctx, lines: readonly { id: string; qty: string; picks: unknown }[], posted: boolean,
  known?: Awaited<ReturnType<typeof returnedOf>>): Promise<Map<string, Quantity>> {
  const gone = !posted ? new Map<string, never>() : known ?? await returnedOf(ctx, lines);
  return new Map(lines.map((l) => [l.id, posted ? roundQty(dec(l.qty).minus(dec(gone.get(l.id)?.qty ?? '0')), 3) : roundQty(dec('0'), 3)]));
}

/** POST /sales/deliveries (deliveries:write): a draft against a confirmed order, from a place. */
export async function addDelivery(ctx: Ctx, input: In<typeof createDelivery>): Promise<Out<typeof createDelivery>> {
  const order = await orderFor(ctx, input.orderId);
  checkDate(input.businessDate, today(), { date: order.businessDate, what: 'order' });
  await checkPlace(ctx, input.locationId, { sellable: true });
  const lines = await checkedLines(ctx, order.id, input.lines);
  const tx = salesTx(ctx);
  const [row] = await tx.insert(deliveries).values({ orderId: order.id, partyId: order.partyId, owner: order.owner, locationId: input.locationId,
    businessDate: input.businessDate, notes: input.notes }).returning({ id: deliveries.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(deliveryLines).values(lines.map((l) => ({ ...l, deliveryId: row.id })));
  return row;
}

/** PUT /sales/deliveries/:id (deliveries:write): a draft, rewritten whole. Any override approved for the old one is
 * stale, and asked for again. */
export async function changeDelivery(ctx: Ctx, { id, ...input }: In<typeof updateDelivery>): Promise<Out<typeof updateDelivery>> {
  const now = await deliveryOf(ctx, id, 'deliveries:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  const order = await orderFor(ctx, input.orderId);
  checkDate(input.businessDate, today(), { date: order.businessDate, what: 'order' });
  await checkPlace(ctx, input.locationId, { sellable: true });
  const lines = await checkedLines(ctx, order.id, input.lines);
  const tx = salesTx(ctx);
  await tx.update(deliveries).set({ orderId: order.id, partyId: order.partyId, owner: order.owner, locationId: input.locationId, businessDate: input.businessDate,
    notes: input.notes, overrideVersion: null }).where(eq(deliveries.id, id));
  await tx.delete(deliveryLines).where(eq(deliveryLines.deliveryId, id));
  await tx.insert(deliveryLines).values(lines.map((l) => ({ ...l, deliveryId: id })));
  return {};
}

/** DELETE /sales/deliveries/:id (deliveries:write): a draft only; it never had a number. */
export async function dropDelivery(ctx: Ctx, { id }: In<typeof deleteDelivery>): Promise<Out<typeof deleteDelivery>> {
  const now = await deliveryOf(ctx, id, 'deliveries:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  await salesTx(ctx).delete(deliveries).where(eq(deliveries.id, id));
  return {};
}

/** POST /sales/deliveries/:id/override (deliveries:write): asks someone holding sales:override to approve the draft's
 * credit issues. */
export async function askDeliveryOverride(ctx: Ctx, { id }: In<typeof requestDeliveryOverride>): Promise<Out<typeof requestDeliveryOverride>> {
  const now = await deliveryOf(ctx, id, 'deliveries:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  return requestApproval(ctx, deliveryOverride, id);
}

/**
 * POST /sales/deliveries/:id/post (deliveries:write). In ADR-006 §1's order: the period lock, the delivery, its order,
 * then the stock engine's positions, batches and units; the entry and the number last, once every check has passed.
 */
export async function postDeliveryNow(ctx: Ctx, { id }: In<typeof postDelivery>): Promise<Out<typeof postDelivery>> {
  const tx = salesTx(ctx);
  // Its date first, unlocked, for the period lock; then the delivery, locked, still on that date: a change committed in
  // between could have moved it to a period not held (auditor-2 on #247).
  const held = (await deliveryOf(ctx, id, 'deliveries:write')).businessDate;
  await holdPeriod(ctx, held);
  const d = await deliveryOf(ctx, id, 'deliveries:write', true);
  if (d.status !== 'draft') throw new AppError('wrong_status', `This delivery is ${d.status}, so it can’t be posted`);
  if (d.businessDate !== held) throw new AppError('version_changed', 'This delivery changed while it was being posted: post it again');
  const order = await orderFor(ctx, d.orderId, true);
  checkDate(d.businessDate, today(), { date: order.businessDate, what: 'order' });
  await checkPlace(ctx, d.locationId, { sellable: true });
  const lines = await deliveryLinesOf(ctx, id);
  // The documents step's last: the lines' live bookings, before the party and the units (the architect on RAD-117).
  const booked = await lockLiveBookings(ctx, lines.map((l) => l.orderLineId));
  const done = await linesDone(ctx, lines.map((l) => ({ orderLineId: l.orderLineId, qty: l.qty })));
  // What's left of the order is read again under its lock: another delivery may have posted since this was drafted.
  await checkedLines(ctx, d.orderId, lines.map((l) => ({ orderLineId: l.orderLineId, qty: q(l.qty), ...picksOf(l.picks) })));
  // ADR-006 §1's step 3: the party, after the documents, so two sales to it take turns at the credit check (ADR-007 §9).
  await holdParty(ctx, d.partyId);
  await checkDelivery(ctx, d, lines);
  const priced = await pricedLines(ctx, d.businessDate, lines);
  // The lines it finishes end their holds, whatever serial leaves (RC-122): the stock engine releases them.
  const moved = await postStock(ctx, { sourceTable: 'deliveries', sourceId: id, businessDate: d.businessDate, endingPromisesOf: done,
    outs: lines.map((l) => {
      const picks = picksOf(l.picks);
      return { itemId: l.itemId, locationId: d.locationId, sourceLineId: l.id, qty: q(l.qty), delivery: true, orderLineId: l.orderLineId,
        batches: picks.batches, units: picks.serials.map((serialNo) => ({ serialNo })) };
    }) });
  // The lines' figures first: once the delivery is posted, its lines are fixed (guard_document_line).
  for (const [i, l] of lines.entries()) {
    await tx.update(deliveryLines).set({ value: moved[i]?.value ?? '0', taxable: priced[i]?.taxable ?? '0', gst: priced[i]?.gst ?? '0' })
      .where(eq(deliveryLines.id, l.id));
  }
  const stock: JournalLine[] = moved.filter((m) => dec(m.value).gt(0))
    .map((m) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId, credit: m.value }));
  const cost = roundMoney(moved.reduce((s, m) => s.plus(dec(m.value)), dec('0')));
  // Goods of no value post no entry: an entry has two lines or more.
  const entry = stock.length === 0 ? null : await postEntry(ctx, { kind: 'delivery', businessDate: d.businessDate,
    source: { table: 'deliveries', id }, lines: [{ account: { system: 'gdni' }, debit: cost }, ...stock] });
  const number = await nextNumber(ctx, DELIVERY_SERIES, d.businessDate);
  await tx.update(deliveries).set({ status: 'posted', number, postedEntryId: entry?.id ?? null }).where(eq(deliveries.id, id));
  await bookingsDelivered(ctx, booked, done);
  // Every line gone: the order is closed (ADR-007 §1).
  if ((await orderDelivered(ctx, order.id)).all) await tx.update(salesOrders).set({ status: 'closed' }).where(eq(salesOrders.id, order.id));
  return { number };
}

/** GET /sales/deliveries/to-invoice (sales:read): posted deliveries with something still to invoice, oldest first
 * (ADR-007 §4), each with what's left at selling value with GST: its lines less what came back and what's invoiced.
 * shortcut: a page skips a delivery with nothing left, so it may hold fewer than its limit; a filter on what's left
 * joins the query if pages grow sparse. */
export async function listToInvoicePage(ctx: Ctx, input: In<typeof listToInvoice>): Promise<Out<typeof listToInvoice>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select({ id: deliveries.id, number: deliveries.number, partyId: deliveries.partyId,
    businessDate: deliveries.businessDate }).from(deliveries).where(and(
    eq(deliveries.status, 'posted'),
    input.filter.partyId === undefined ? undefined : eq(deliveries.partyId, input.filter.partyId),
    listScope(ctx, 'sales:read', deliveries.owner),
    after([deliveries.businessDate, deliveries.id], key && [key.date, key.id], 'asc'),
  )).orderBy(asc(deliveries.businessDate), asc(deliveries.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const lines = page.length === 0 ? [] : await salesTx(ctx).select({ id: deliveryLines.id, deliveryId: deliveryLines.deliveryId,
    lineNo: deliveryLines.lineNo, itemId: deliveryLines.itemId, qty: deliveryLines.qty, taxable: deliveryLines.taxable,
    gst: deliveryLines.gst, picks: deliveryLines.picks }).from(deliveryLines)
    .where(inArray(deliveryLines.deliveryId, page.map((p) => p.id))).orderBy(asc(deliveryLines.lineNo));
  const back = await returnedOf(ctx, lines);
  const left = new Map<string, ReturnType<typeof dec>>();
  for (const l of lines) {
    const b = back.get(l.id);
    const more = dec(l.taxable ?? '0').plus(dec(l.gst ?? '0')).minus(dec(b?.taxable ?? '0')).minus(dec(b?.gst ?? '0'));
    left.set(l.deliveryId, (left.get(l.deliveryId) ?? dec('0')).plus(more));
  }
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  // Each line still to invoice, by quantity, with its item (auditor-3 on #285).
  const qtyLeft = await leftToInvoice(ctx, lines, true, back);
  const open = (await labelled(ctx, lines)).filter((l) => dec(qtyLeft.get(l.id) ?? '0').gt(0));
  const last = page.at(-1);
  return {
    items: page.filter((r) => (left.get(r.id) ?? dec('0')).gt(0))
      .map((r) => ({ ...r, number: r.number ?? '', partyName: names.get(r.partyId) ?? '', toInvoice: roundMoney(left.get(r.id) ?? dec('0')),
        lines: open.filter((l) => l.deliveryId === r.id).map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, sku: l.sku, name: l.name,
          qtyToInvoice: qtyLeft.get(l.id) ?? '0' })) })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, id: last.id }) : null,
  };
}

