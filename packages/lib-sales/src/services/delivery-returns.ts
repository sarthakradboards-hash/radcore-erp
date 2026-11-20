// Delivery returns (M3-08, RAD-112; ADR-006 §4, §4a, §6, F5's variant; RC-207): goods taken back before they're
// invoiced, all or part of a posted delivery's lines, into a place. Each line names which of the batches it left with
// come back, and which serials. Posting puts each line back at its share of the value it went out at, the last return
// of a line clearing what's left of it exactly, each unit with its `delivery_returned` event; it releases the same from
// Goods Delivered Not Invoiced (entry `delivery_return`: Dr Stock in Hand by item and place, Cr GDNI), and draws its
// number (DR) last. Its share of the line's selling value leaves the party's delivered-not-invoiced with it.
import { after, deliveries, deliveryLines, deliveryReturnLines, deliveryReturns, salesOrders, salesTx } from '@radcore/db/sales';
import { holdPeriod, postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, roundRate } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSeries, encodeCursor, listScope, nextNumber, type Ctx } from '@radcore/lib-platform';
import { checkPlace, checkQuantity, postStock, serialKey } from '@radcore/lib-stock';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  createDeliveryReturn, deleteDeliveryReturn, getDeliveryReturn, listDeliveryReturns, postDeliveryReturn, updateDeliveryReturn,
} from '../contract.ts';
import { orderDelivered, pickedBatchKey, picksOf, returnedOf } from './delivered.ts';
import { checkDate, shareOf } from './document-rules.ts';
import { today } from './document-lines.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type LineIn = In<typeof createDeliveryReturn>['lines'][number];
type Status = 'draft' | 'posted' | 'cancelled';

/** Delivery returns' numbers (ADR-007 §3): DR/26-27/00001, drawn when a return posts. */
export const DELIVERY_RETURN_SERIES = defineSeries('sales.delivery_return', 'DR', { digits: 5, label: 'Delivery returns' });

const header = { id: deliveryReturns.id, number: deliveryReturns.number, deliveryId: deliveryReturns.deliveryId,
  partyId: deliveryReturns.partyId, locationId: deliveryReturns.locationId, businessDate: deliveryReturns.businessDate,
  status: deliveryReturns.status, notes: deliveryReturns.notes };
const PAGE_KEY = z.object({ date: z.iso.date(), id: z.uuid() });
const q = (s: string) => quantityString().parse(s);
const wrongStatus = (status: string, what = 'changed') => new AppError('wrong_status', `This return is ${status}, so it can’t be ${what}`);
const notOnSource = (path: (string | number)[], message: string) =>
  new AppError('not_on_source', 'That didn’t go on this delivery', [{ path, code: 'not_on_source', message }]);

/** The return, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
async function returnOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = salesTx(ctx).select({ ...header, owner: deliveryReturns.owner }).from(deliveryReturns).where(eq(deliveryReturns.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such return');
  // Its delivery's owner's, whoever made it (ADR-007 §1).
  ctx.see(permission, { owner: row.owner });
  return row;
}

/** The delivery goods come back from: one the principal may see (sales:read), and posted. Locked as a return posts, so
 * two returns of one delivery take turns over what's left of it. */
async function deliveryFor(ctx: Ctx, deliveryId: string, forUpdate = false) {
  const sel = salesTx(ctx).select({ id: deliveries.id, orderId: deliveries.orderId, partyId: deliveries.partyId,
    businessDate: deliveries.businessDate, status: deliveries.status, owner: deliveries.owner }).from(deliveries)
    .where(eq(deliveries.id, deliveryId));
  const [d] = forUpdate ? await sel.for('update') : await sel;
  if (d === undefined) {
    throw new AppError('not_found', 'There is no such delivery', [{ path: ['deliveryId'], code: 'unknown', message: 'Choose a delivery' }]);
  }
  ctx.see('sales:read', { owner: d.owner });
  if (d.status !== 'posted') throw new AppError('wrong_status', `This delivery is ${d.status}: only a posted delivery’s goods come back`);
  return d;
}

/**
 * A return's lines against its delivery: each names one of its lines, in a quantity its item's unit allows and no more
 * than is still out (`over_quantity`), from the batches the line left with, each no more than it sent out less what
 * has come back, and serials the line took and that haven't come back (`not_on_source`). Answers each line with what
 * it went out at and what earlier returns took, for its share.
 */
async function checkedLines(ctx: Ctx, deliveryId: string, lines: readonly LineIn[]) {
  const sent = new Map((await salesTx(ctx).select({ id: deliveryLines.id, itemId: deliveryLines.itemId, qty: deliveryLines.qty,
    picks: deliveryLines.picks, value: deliveryLines.value, taxable: deliveryLines.taxable, gst: deliveryLines.gst }).from(deliveryLines)
    .where(eq(deliveryLines.deliveryId, deliveryId))).map((l) => [l.id, l]));
  const back = await returnedOf(ctx, [...sent.values()]);
  const seen = new Set<string>();
  const rows = [];
  for (const [n, l] of lines.entries()) {
    const line = sent.get(l.deliveryLineId);
    if (line === undefined || seen.has(line.id)) {
      throw notOnSource(['lines', n, 'deliveryLineId'], line === undefined ? 'Choose one of the delivery’s lines' : 'Name each line once');
    }
    seen.add(line.id);
    await checkQuantity(ctx, line.itemId, l.qty).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
    });
    const was = back.get(line.id);
    if (was === undefined) throw new Error(`delivery line ${line.id} has no answer`);
    const out = dec(line.qty).minus(dec(was.qty));
    if (dec(l.qty).gt(out)) {
      throw new AppError('over_quantity', 'That’s more than is still out on this delivery',
        [{ path: ['lines', n, 'qty'], code: 'over_quantity', message: `${out.toFixed()} still out` }]);
    }
    const picked = picksOf(line.picks);
    for (const [b, batch] of l.batches.entries()) {
      const left = picked.batches.filter((p) => p.batchId === batch.batchId).reduce((s, p) => s.plus(dec(p.qty)), dec('0'))
        .minus(dec(was.batches.get(pickedBatchKey(batch.batchId)) ?? '0'));
      if (dec(batch.qty).gt(left)) {
        throw new AppError('over_quantity', 'That’s more of a batch than went out in it and is still out',
          [{ path: ['lines', n, 'batches', b, 'qty'], code: 'over_quantity', message: `${left.toFixed()} of this batch still out` }]);
      }
    }
    const took = new Set(picked.serials.map(serialKey));
    for (const [s, serial] of l.serials.entries()) {
      if (!took.has(serialKey(serial)) || was.serials.get(serialKey(serial)) === true) {
        throw notOnSource(['lines', n, 'serials', s], `${serial} isn’t out on this line`);
      }
    }
    rows.push({ lineNo: n + 1, deliveryLineId: line.id, itemId: line.itemId, qty: l.qty, picks: { batches: l.batches, serials: l.serials },
      sent: line, was });
  }
  return rows;
}

/** GET /sales/delivery-returns (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listDeliveryReturnsPage(ctx: Ctx, input: In<typeof listDeliveryReturns>): Promise<Out<typeof listDeliveryReturns>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select(header).from(deliveryReturns).where(and(
    input.filter.status === undefined ? undefined : eq(deliveryReturns.status, input.filter.status),
    input.filter.deliveryId === undefined ? undefined : eq(deliveryReturns.deliveryId, input.filter.deliveryId),
    listScope(ctx, 'sales:read', deliveryReturns.owner),
    after([deliveryReturns.businessDate, deliveryReturns.id], key && [key.date, key.id], 'desc'),
  )).orderBy(desc(deliveryReturns.businessDate), desc(deliveryReturns.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, id: last.id }) : null,
  };
}

/** GET /sales/delivery-returns/:id (sales:read). */
export async function getDeliveryReturnById(ctx: Ctx, { id }: In<typeof getDeliveryReturn>): Promise<Out<typeof getDeliveryReturn>> {
  // The maker goes too, and the contract's answer leaves it out.
  const r = await returnOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select({ id: deliveryReturnLines.id, lineNo: deliveryReturnLines.lineNo,
    deliveryLineId: deliveryReturnLines.deliveryLineId, itemId: deliveryReturnLines.itemId, qty: deliveryReturnLines.qty,
    picks: deliveryReturnLines.picks, value: deliveryReturnLines.value, taxable: deliveryReturnLines.taxable, gst: deliveryReturnLines.gst })
    .from(deliveryReturnLines).where(eq(deliveryReturnLines.returnId, id)).orderBy(asc(deliveryReturnLines.lineNo));
  const names = await partyNames(ctx, [r.partyId]);
  return { ...r, status: r.status as Status, partyName: names.get(r.partyId) ?? '',
    lines: lines.map(({ picks, ...l }) => ({ ...l, ...picksOf(picks) })) };
}

const stored = (lines: Awaited<ReturnType<typeof checkedLines>>) =>
  lines.map((l) => ({ lineNo: l.lineNo, deliveryLineId: l.deliveryLineId, itemId: l.itemId, qty: l.qty, picks: l.picks }));

/** POST /sales/delivery-returns (deliveries:write): a draft against a posted delivery, into a place. */
export async function addDeliveryReturn(ctx: Ctx, input: In<typeof createDeliveryReturn>): Promise<Out<typeof createDeliveryReturn>> {
  const d = await deliveryFor(ctx, input.deliveryId);
  checkDate(input.businessDate, today(), { date: d.businessDate, what: 'delivery' });
  await checkPlace(ctx, input.locationId);
  const lines = await checkedLines(ctx, d.id, input.lines);
  const tx = salesTx(ctx);
  const [row] = await tx.insert(deliveryReturns).values({ deliveryId: d.id, partyId: d.partyId, owner: d.owner, locationId: input.locationId,
    businessDate: input.businessDate, notes: input.notes }).returning({ id: deliveryReturns.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(deliveryReturnLines).values(stored(lines).map((l) => ({ ...l, returnId: row.id })));
  return row;
}

/** PUT /sales/delivery-returns/:id (deliveries:write): a draft, rewritten whole. */
export async function changeDeliveryReturn(ctx: Ctx, { id, ...input }: In<typeof updateDeliveryReturn>): Promise<Out<typeof updateDeliveryReturn>> {
  const now = await returnOf(ctx, id, 'deliveries:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  const d = await deliveryFor(ctx, input.deliveryId);
  checkDate(input.businessDate, today(), { date: d.businessDate, what: 'delivery' });
  await checkPlace(ctx, input.locationId);
  const lines = await checkedLines(ctx, d.id, input.lines);
  const tx = salesTx(ctx);
  await tx.update(deliveryReturns).set({ deliveryId: d.id, partyId: d.partyId, owner: d.owner, locationId: input.locationId, businessDate: input.businessDate,
    notes: input.notes }).where(eq(deliveryReturns.id, id));
  await tx.delete(deliveryReturnLines).where(eq(deliveryReturnLines.returnId, id));
  await tx.insert(deliveryReturnLines).values(stored(lines).map((l) => ({ ...l, returnId: id })));
  return {};
}

/** DELETE /sales/delivery-returns/:id (deliveries:write): a draft only. */
export async function dropDeliveryReturn(ctx: Ctx, { id }: In<typeof deleteDeliveryReturn>): Promise<Out<typeof deleteDeliveryReturn>> {
  const now = await returnOf(ctx, id, 'deliveries:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  await salesTx(ctx).delete(deliveryReturns).where(eq(deliveryReturns.id, id));
  return {};
}

/**
 * POST /sales/delivery-returns/:id/post (deliveries:write). In ADR-006 §1's order: the period lock, the return, its
 * delivery, then the stock engine's; the entry and the number last.
 */
export async function postDeliveryReturnNow(ctx: Ctx, { id }: In<typeof postDeliveryReturn>): Promise<Out<typeof postDeliveryReturn>> {
  const tx = salesTx(ctx);
  // Its date first, unlocked, for the period lock; then the return, locked, still on that date (auditor-2 on #247).
  const held = (await returnOf(ctx, id, 'deliveries:write')).businessDate;
  await holdPeriod(ctx, held);
  const r = await returnOf(ctx, id, 'deliveries:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'posted');
  if (r.businessDate !== held) throw new AppError('version_changed', 'This return changed while it was being posted: post it again');
  const d = await deliveryFor(ctx, r.deliveryId, true);
  // Its order, locked after the delivery as a delivery's posting locks them, for reopening below.
  const [order] = await tx.select({ status: salesOrders.status, closeReason: salesOrders.closeReason, owner: salesOrders.createdBy })
    .from(salesOrders).where(eq(salesOrders.id, d.orderId)).for('update');
  if (order !== undefined) ctx.see('sales:read', { owner: order.owner });
  checkDate(r.businessDate, today(), { date: d.businessDate, what: 'delivery' });
  await checkPlace(ctx, r.locationId);
  const drafted = await tx.select({ id: deliveryReturnLines.id, deliveryLineId: deliveryReturnLines.deliveryLineId, qty: deliveryReturnLines.qty,
    picks: deliveryReturnLines.picks }).from(deliveryReturnLines).where(eq(deliveryReturnLines.returnId, id)).orderBy(asc(deliveryReturnLines.lineNo));
  // What's still out is read again under the delivery's lock: another return may have posted since this was drafted.
  const lines = await checkedLines(ctx, d.id, drafted.map((l) => ({ deliveryLineId: l.deliveryLineId, qty: q(l.qty), ...picksOf(l.picks) })));
  const shares = lines.map((l) => {
    const share = (total: string | null, took: string) => shareOf(total ?? '0', l.sent.qty, { qty: l.was.qty, share: took }, l.qty);
    return { value: share(l.sent.value, l.was.value), taxable: share(l.sent.taxable, l.was.taxable), gst: share(l.sent.gst, l.was.gst) };
  });
  const moved = await postStock(ctx, { sourceTable: 'delivery_returns', sourceId: id, businessDate: r.businessDate,
    ins: lines.map((l, i) => {
      const value = shares[i]?.value ?? roundMoney('0');
      return { itemId: l.itemId, locationId: r.locationId, sourceLineId: drafted[i]?.id ?? null, qty: q(l.qty), value,
        rate: roundRate(dec(value).div(dec(l.qty))), batches: l.picks.batches,
        units: l.picks.serials.map((serialNo) => ({ serialNo })), unitEvent: 'delivery_returned' as const };
    }) });
  // The lines' figures first: once the return is posted, its lines are fixed (guard_document_line).
  for (const [i, l] of drafted.entries()) {
    const s = shares[i];
    await tx.update(deliveryReturnLines).set({ value: s?.value ?? '0', taxable: s?.taxable ?? '0', gst: s?.gst ?? '0' })
      .where(eq(deliveryReturnLines.id, l.id));
  }
  // The goods' own movements; a revaluation of a place below zero is the engine's, in its own entry (F15).
  const stock: JournalLine[] = moved.filter((m) => m.direction === 'in' && dec(m.value).gt(0))
    .map((m) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId, debit: m.value }));
  const value = roundMoney(stock.reduce((s, l) => s.plus(dec(l.debit ?? '0')), dec('0')));
  const entry = stock.length === 0 ? null : await postEntry(ctx, { kind: 'delivery_return', businessDate: r.businessDate,
    source: { table: 'delivery_returns', id }, lines: [...stock, { account: { system: 'gdni' }, credit: value }] });
  const number = await nextNumber(ctx, DELIVERY_RETURN_SERIES, r.businessDate);
  await tx.update(deliveryReturns).set({ status: 'posted', number, postedEntryId: entry?.id ?? null }).where(eq(deliveryReturns.id, id));
  // A line back below what was ordered reopens an order its deliveries closed, so the goods can go again; one a person
  // closed short (with its reason) stays closed (ADR-007 §1).
  if (order?.status === 'closed' && order.closeReason === null && !(await orderDelivered(ctx, d.orderId)).all) {
    await tx.update(salesOrders).set({ status: 'confirmed' }).where(eq(salesOrders.id, d.orderId));
  }
  return { number };
}
