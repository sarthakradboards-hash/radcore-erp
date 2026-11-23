// Goods receipts and QC (M4-02, RAD-137; ADR-008 §1, §3, §4, §6, §12; ADR-006 §1, §4a, §5, §6, F2, F21, F22). A draft
// records what arrived against one placed PO (inward:write); posting it is QC done (inward:qc): one save splits each
// line into accepted and rejected, puts the accepted goods into the receipt's sellable place and the rejects into its
// rejects place, both at the PO line's rate, in the supplier's batches (RC-028), and posts Dr Stock in Hand, Cr Goods
// Received Not Billed. Rejects never enter the selling average, since they're at a place of their own (RC-205).
// Its own number names a batch (ADR-006 §4a), so it draws it before posting: period → PO → receipt → stock → the JV
// and GRN turns → its number → its batches → the posting (the architect on RAD-141, ADR-008 §12). Cancelling mirrors it.
import { after, goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { getPartyById, holdPeriod, JOURNAL_SERIES, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, indiaDate, roundMoney, type Money, type Quantity } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, holdSeries, listScope, momentKey, nextNumber, principalId, type Ctx,
} from '@radcore/lib-platform';
import {
  batchKey, checkPlace, checkQuantity, holdStock, itemFlags, itemLabels, placeNames, postStock, reverseStock, serialKey, unitOwners,
  type StockIn,
} from '@radcore/lib-stock';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelGoodsReceipt, createGoodsReceipt, deleteGoodsReceipt, getGoodsReceipt, listGoodsReceipts, postGoodsReceipt, updateGoodsReceipt,
} from '../contract.ts';
import { billedQty } from './billed.ts';
import { receivedOf, settleOrder } from './received.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Row = typeof goodsReceipts.$inferSelect;
type Arrival = Omit<In<typeof createGoodsReceipt>, 'orderId'>;
type QcLine = In<typeof postGoodsReceipt>['lines'][number];

/** The receipt series (ADR-008 §3): GRN/YY-YY/NNNNN, drawn as it posts, and the batch of goods that name none. */
export const RECEIPT_SERIES = defineSeries('purchasing.receipt', 'GRN', { digits: 5, label: 'Goods receipts' });

const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const SOURCE = 'goods_receipts';
const today = (): string => indiaDate(new Date());
const refuse = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This receipt is ${status}, so it can’t be ${what}`);

/** The receipt within the principal's scope for `key`, by its maker (ADR-008 §13), else not_found; locked to change it. */
async function receiptOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = purchasingTx(ctx).select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw new AppError('not_found', 'There is no such goods receipt');
  ctx.see(key, { owner: row.createdBy });
  return row;
}

/** The PO goods come in against, if the principal may see it and it's placed (§6), with its lines; locked first when a
 * receipt posts or is cancelled (§12: purchase orders, then goods receipts). */
async function orderFor(ctx: Ctx, orderId: string, forUpdate = false) {
  const tx = purchasingTx(ctx);
  const q = tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).limit(1);
  const [order] = forUpdate ? await q.for('update') : await q;
  if (order === undefined || !ctx.can('purchasing:read', { owner: order.createdBy })) {
    throw refuse('unknown_order', 'There is no such purchase order', ['orderId']);
  }
  const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId)).orderBy(asc(purchaseOrderLines.lineNo));
  return { order, lines: new Map(lines.map((l) => [l.id, l])) };
}
type Order = Awaited<ReturnType<typeof orderFor>>;

/** What arrived (§4, §6): dated not after today nor before its PO, in an open year after the period lock; the accepted
 * goods' place sellable and the rejects' of kind rejected; each line one of the PO's, received in its unit, and no PO
 * line past what it ordered, counting its other receipts, posted, and drafts unless it's posting (`over_ordered`). */
async function checkArrival(ctx: Ctx, a: Arrival, { order, lines }: Order, o: { except?: string; posting: boolean }): Promise<void> {
  if (order.status !== 'placed') throw refuse('order_not_placed', `This purchase order is ${order.status}: goods come in only on a placed one`, ['orderId']);
  if (a.businessDate > today()) throw refuse('date_in_future', 'A receipt can’t be dated after today', ['businessDate']);
  if (a.businessDate < order.businessDate) throw refuse('date_before_source', `The purchase order is dated ${order.businessDate}`, ['businessDate']);
  await holdPeriod(ctx, a.businessDate);
  await checkPlace(ctx, a.locationId, { sellable: true });
  await checkPlace(ctx, a.rejectsLocationId, { rejects: true, path: 'rejectsLocationId' });
  const asked = new Map<string, ReturnType<typeof dec>>();
  for (const [n, l] of a.lines.entries()) {
    const ordered = lines.get(l.orderLineId);
    if (ordered === undefined) throw refuse('unknown_order_line', 'That line isn’t on this purchase order', ['lines', n, 'orderLineId']);
    if (!dec(l.received).gt(0)) throw refuse('qty_not_positive', 'Enter how many came', ['lines', n, 'received']);
    await checkQuantity(ctx, ordered.itemId, l.received).catch((e: unknown) => {
      throw e instanceof AppError ? refuse(e.code, e.message, ['lines', n, 'received']) : e;
    });
    asked.set(l.orderLineId, (asked.get(l.orderLineId) ?? dec('0')).plus(dec(l.received)));
  }
  const got = await receivedOf(ctx, [...asked.keys()], { drafts: !o.posting, ...(o.except === undefined ? {} : { except: o.except }) });
  for (const [n, l] of a.lines.entries()) {
    const ordered = lines.get(l.orderLineId);
    const left = dec(ordered?.qty ?? '0').minus(got.get(l.orderLineId) ?? dec('0'));
    if ((asked.get(l.orderLineId) ?? dec('0')).gt(left)) {
      throw refuse('over_ordered', `Only ${left.toFixed()} of this line is still to come: extra goods need a line of their own`, ['lines', n, 'received']);
    }
  }
}

const writeLines = async (ctx: Ctx, receiptId: string, a: Arrival, lines: Order['lines']) => {
  await purchasingTx(ctx).insert(goodsReceiptLines).values(a.lines.map((l, i) => ({ receiptId, lineNo: i + 1, orderLineId: l.orderLineId,
    itemId: lines.get(l.orderLineId)?.itemId ?? '', received: l.received })));
};
const header = (a: Arrival) => ({ businessDate: a.businessDate, locationId: a.locationId, rejectsLocationId: a.rejectsLocationId,
  supplierRef: a.supplierRef, notes: a.notes });

/** POST /purchasing/receipts (inward:write): what arrived, as a draft. */
export async function addReceipt(ctx: Ctx, input: In<typeof createGoodsReceipt>): Promise<Out<typeof createGoodsReceipt>> {
  const order = await orderFor(ctx, input.orderId);
  await checkArrival(ctx, input, order, { posting: false });
  const [row] = await purchasingTx(ctx).insert(goodsReceipts).values({ orderId: input.orderId, partyId: order.order.partyId, ...header(input) })
    .returning({ id: goodsReceipts.id });
  if (row === undefined) throw new Error('the goods receipt was not stored');
  await writeLines(ctx, row.id, input, order.lines);
  return { id: row.id };
}

/** PUT /purchasing/receipts/:id (inward:write): a draft's arrival rewritten whole. */
export async function changeReceipt(ctx: Ctx, { id, ...input }: In<typeof updateGoodsReceipt>): Promise<Out<typeof updateGoodsReceipt>> {
  const r = await receiptOf(ctx, id, 'inward:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'changed');
  const order = await orderFor(ctx, r.orderId);
  await checkArrival(ctx, input, order, { except: id, posting: false });
  const tx = purchasingTx(ctx);
  await tx.update(goodsReceipts).set(header(input)).where(eq(goodsReceipts.id, id));
  await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, id));
  await writeLines(ctx, id, input, order.lines);
  return {};
}

/** DELETE /purchasing/receipts/:id (inward:write): a draft thrown away. */
export async function dropReceipt(ctx: Ctx, { id }: In<typeof deleteGoodsReceipt>): Promise<Out<typeof deleteGoodsReceipt>> {
  const r = await receiptOf(ctx, id, 'inward:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'deleted: cancel it instead');
  await purchasingTx(ctx).delete(goodsReceipts).where(eq(goodsReceipts.id, id));
  return {};
}

const linesOf = (ctx: Ctx, id: string) => purchasingTx(ctx).select().from(goodsReceiptLines)
  .where(eq(goodsReceiptLines.receiptId, id)).orderBy(asc(goodsReceiptLines.lineNo));
type Line = Awaited<ReturnType<typeof linesOf>>[number];
type Split = { line: Line; qc: QcLine; accepted: Quantity; rejected: Quantity };

const sumOf = (xs: readonly string[]) => xs.reduce((s, x) => s.plus(dec(x)), dec('0'));
const sameBatch = (a: string | null, b: string | null) => (a === null || b === null ? a === b : batchKey(a) === batchKey(b));

/**
 * QC (§6): every draft line inspected once, its batches' accepted and rejected adding up to what came (`qc_mismatch`),
 * a reason for any reject, and a serialised item's units named one for each piece in their batches (`serials_mismatch`),
 * each serial once, with a chassis number exactly where the item keeps one (F22), none already sold (`serial_sold`) or
 * in our stock (`serial_in_stock`). One that went back to its supplier can come in again.
 */
async function checkQc(ctx: Ctx, lines: readonly Line[], qc: readonly QcLine[]): Promise<Split[]> {
  const byLine = new Map(qc.map((q) => [q.lineId, q]));
  if (byLine.size !== qc.length || qc.length !== lines.length || lines.some((l) => !byLine.has(l.id))) {
    throw refuse('qc_mismatch', 'Inspect every line of the receipt once', ['lines']);
  }
  const flags = await itemFlags(ctx, lines.map((l) => l.itemId));
  const seen = new Set<string>();
  const out: Split[] = [];
  for (const line of lines) {
    const q = byLine.get(line.id) as QcLine;
    const n = qc.indexOf(q);
    const accepted = sumOf(q.batches.map((b) => b.accepted));
    const rejected = sumOf(q.batches.map((b) => b.rejected));
    if (!accepted.plus(rejected).eq(dec(line.received))) {
      throw refuse('qc_mismatch', `Accepted and rejected add up to the ${dec(line.received).toFixed()} that came`, ['lines', n, 'batches']);
    }
    if (q.batches.some((b, i) => q.batches.findIndex((c) => sameBatch(c.batchNo, b.batchNo)) !== i)) {
      throw refuse('qc_mismatch', 'Name each batch once', ['lines', n, 'batches']);
    }
    for (const [b, batch] of q.batches.entries()) {
      for (const part of ['accepted', 'rejected'] as const) {
        await checkQuantity(ctx, line.itemId, batch[part]).catch((e: unknown) => {
          throw e instanceof AppError ? refuse(e.code, e.message, ['lines', n, 'batches', b, part]) : e;
        });
      }
    }
    if (rejected.gt(0) && q.rejectReason === null) throw refuse('reject_reason_required', 'Say why it was rejected', ['lines', n, 'rejectReason']);
    const item = flags.get(line.itemId);
    if (item?.serialised !== true) {
      if (q.serials.length > 0) throw refuse('not_serialised', 'This item isn’t tracked by serial', ['lines', n, 'serials']);
    } else {
      for (const batch of q.batches) {
        const of = (rej: boolean) => dec(String(q.serials.filter((s) => s.rejected === rej && sameBatch(s.batchNo, batch.batchNo)).length));
        if (!of(false).eq(dec(batch.accepted)) || !of(true).eq(dec(batch.rejected))) {
          throw refuse('serials_mismatch', 'Name a serial for each unit, in its batch, accepted or rejected', ['lines', n, 'serials']);
        }
      }
      if (!dec(String(q.serials.length)).eq(dec(line.received))) {
        throw refuse('serials_mismatch', 'Name a serial for each unit, in its batch', ['lines', n, 'serials']);
      }
      for (const [s, serial] of q.serials.entries()) {
        const key = `${line.itemId} ${serialKey(serial.serialNo)}`;
        if (seen.has(key)) throw refuse('serial_twice', `${serial.serialNo} is named twice`, ['lines', n, 'serials', s, 'serialNo']);
        seen.add(key);
        if (serial.chassisNo === null && item.hasChassis) {
          throw refuse('chassis_required', 'This item keeps a chassis number: enter each unit’s', ['lines', n, 'serials', s, 'chassisNo']);
        }
        if (serial.chassisNo !== null && !item.hasChassis) {
          throw refuse('chassis_not_allowed', 'This item keeps no chassis number', ['lines', n, 'serials', s, 'chassisNo']);
        }
      }
      const owners = await unitOwners(ctx, line.itemId, q.serials.map((s) => s.serialNo));
      for (const [s, serial] of q.serials.entries()) {
        const owner = owners.get(serialKey(serial.serialNo));
        if (owner === 'customer') throw refuse('serial_sold', `${serial.serialNo} has been sold: it can’t be received`, ['lines', n, 'serials', s, 'serialNo']);
        if (owner === 'ours') throw refuse('serial_in_stock', `${serial.serialNo} is already in stock`, ['lines', n, 'serials', s, 'serialNo']);
      }
    }
    out.push({ line, qc: q, accepted: accepted.toFixed(3) as Quantity, rejected: rejected.toFixed(3) as Quantity });
  }
  return out;
}

/** The goods coming in for one part of a line, accepted or rejected: its batches (the receipt's own number where the
 * supplier named none, ADR-006 §4a) and its units, `new` if accepted, `damaged` if rejected (F2). */
function partIn(s: Split, rejected: boolean, at: { locationId: string; rate: string; number: string }): StockIn | null {
  const qty = rejected ? s.rejected : s.accepted;
  if (!dec(qty).gt(0)) return null;
  const part = rejected ? 'rejected' : 'accepted';
  return { itemId: s.line.itemId, locationId: at.locationId, sourceLineId: s.line.id, qty, rate: at.rate as StockIn['rate'],
    batches: s.qc.batches.filter((b) => dec(b[part]).gt(0)).map((b) => ({ batchNo: b.batchNo ?? at.number, qty: b[part] as Quantity })),
    units: s.qc.serials.filter((u) => u.rejected === rejected).map((u) => ({ serialNo: u.serialNo, chassisNo: u.chassisNo,
      batchNo: u.batchNo ?? at.number, condition: rejected ? 'damaged' as const : 'new' as const })),
    unitEvent: 'received' };
}

/** POST /purchasing/receipts/:id/post (inward:qc): QC done, posted in one save (§6, F2). */
export async function postReceipt(ctx: Ctx, { id, lines: qc }: In<typeof postGoodsReceipt>): Promise<Out<typeof postGoodsReceipt>> {
  // §12: the period first, so read the draft unlocked to learn its date and PO, then lock the PO, then the receipt.
  const seen = await receiptOf(ctx, id, 'inward:qc');
  if (seen.status !== 'draft') throw wrongStatus(seen.status, 'posted');
  await holdPeriod(ctx, seen.businessDate);
  const order = await orderFor(ctx, seen.orderId, true);
  const r = await receiptOf(ctx, id, 'inward:qc', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'posted');
  const lines = await linesOf(ctx, id);
  await checkArrival(ctx, { ...r, lines: lines.map((l) => ({ orderLineId: l.orderLineId, received: l.received as Quantity })) }, order,
    { except: id, posting: true });
  const splits = await checkQc(ctx, lines, qc);
  // Its stock, then the journal's and its own series' turns, then its number, which names its unnamed batches.
  await holdStock(ctx, splits.flatMap((s) => [
    { itemId: s.line.itemId, locationId: r.locationId, serials: s.qc.serials.filter((u) => !u.rejected).map((u) => u.serialNo) },
    { itemId: s.line.itemId, locationId: r.rejectsLocationId, serials: s.qc.serials.filter((u) => u.rejected).map((u) => u.serialNo) },
  ]));
  await holdSeries(ctx, [JOURNAL_SERIES, RECEIPT_SERIES]);
  const number = await nextNumber(ctx, RECEIPT_SERIES, r.businessDate);
  const parts = splits.map((s) => {
    const rate = order.lines.get(s.line.orderLineId)?.rate ?? '0';
    return { s, rate, accepted: partIn(s, false, { locationId: r.locationId, rate, number }),
      rejected: partIn(s, true, { locationId: r.rejectsLocationId, rate, number }) };
  });
  const ins = parts.flatMap((p) => [p.accepted, p.rejected].filter((x): x is StockIn => x !== null));
  const moved = (await postStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate: r.businessDate, supplierId: r.partyId, ins }))
    .filter((m) => m.direction === 'in');
  const stock: JournalLine[] = moved.filter((m) => dec(m.value).gt(0))
    .map((m) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId, debit: m.value }));
  const value = roundMoney(moved.reduce((s, m) => s.plus(dec(m.value)), dec('0')));
  // Free goods (rate 0) carry no value, and post no entry: an entry has two lines or more.
  const entry = stock.length === 0 ? null : await postEntry(ctx, { kind: 'goods_receipt', businessDate: r.businessDate,
    source: { table: SOURCE, id }, lines: [...stock, { account: { system: 'grni' }, credit: value }] });
  const tx = purchasingTx(ctx);
  let at = 0;
  for (const p of parts) {
    const accepted = p.accepted === null ? null : moved[at++];
    const rejected = p.rejected === null ? null : moved[at++];
    await tx.update(goodsReceiptLines).set({ accepted: p.s.accepted, rejected: p.s.rejected, rate: p.rate,
      acceptedValue: accepted?.value ?? '0.00', rejectedValue: rejected?.value ?? '0.00', rejectReason: p.s.qc.rejectReason,
      acceptedMovementId: accepted?.id ?? null, rejectedMovementId: rejected?.id ?? null,
      qc: { batches: p.s.qc.batches, serials: p.s.qc.serials } }).where(eq(goodsReceiptLines.id, p.s.line.id));
  }
  await tx.update(goodsReceipts).set({ status: 'posted', number, value, postedEntryId: entry?.id ?? null }).where(eq(goodsReceipts.id, id));
  await settleOrder(ctx, order.order);
  return { number };
}

/** POST /purchasing/receipts/:id/cancel (inward:qc): its mirror, dated the cancellation's day, while nothing on it has
 * been billed, returned or moved on (`receipt_in_use`); its PO lines' received quantities fall back with it. */
export async function cancelReceiptNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelGoodsReceipt>): Promise<Out<typeof cancelGoodsReceipt>> {
  await holdPeriod(ctx, businessDate);
  const seen = await receiptOf(ctx, id, 'inward:qc');
  const order = await orderFor(ctx, seen.orderId, true);
  const r = await receiptOf(ctx, id, 'inward:qc', true);
  if (r.status !== 'posted') throw wrongStatus(r.status, 'cancelled');
  if (businessDate > today()) throw refuse('date_in_future', 'A cancellation can’t be dated after today', ['businessDate']);
  if (businessDate < r.businessDate) throw refuse('date_before_source', `The receipt is dated ${r.businessDate}`, ['businessDate']);
  // A receipt any of it was billed on stays (RAD-138): its bill clears what it accrued. shortcut: supplier returns (M4-05)
  // aren't built yet, so nothing on a receipt can be returned; their check joins this one when they land.
  const billed = await billedQty(ctx, (await linesOf(ctx, id)).map((l) => l.id));
  if ([...billed.values()].some((q) => q.gt(0))) {
    throw new AppError('receipt_in_use', 'Goods on this receipt have been billed, so it can’t be cancelled: cancel the bill first');
  }
  await reverseStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['not_enough_stock', 'units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('receipt_in_use', 'Goods on this receipt have moved on since, so it can’t be cancelled: return them instead');
    }
    throw e;
  });
  const [own] = r.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: SOURCE, id }, businessDate, reason });
  await purchasingTx(ctx).update(goodsReceipts).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(goodsReceipts.id, id));
  await settleOrder(ctx, order.order);
  return {};
}

const headerCols = { id: goodsReceipts.id, number: goodsReceipts.number, orderId: goodsReceipts.orderId, orderNumber: purchaseOrders.number,
  supplierId: goodsReceipts.partyId, businessDate: goodsReceipts.businessDate, status: goodsReceipts.status, locationId: goodsReceipts.locationId,
  rejectsLocationId: goodsReceipts.rejectsLocationId, supplierRef: goodsReceipts.supplierRef, value: goodsReceipts.value,
  createdAt: goodsReceipts.createdAt, notes: goodsReceipts.notes };
type HeaderRow = { id: string; number: string | null; orderId: string; orderNumber: string | null; supplierId: string; businessDate: string;
  status: string; locationId: string; rejectsLocationId: string; supplierRef: string | null; value: string | null };

// Names for a page of receipts. shortcut: one read per distinct supplier on the page, as the PO list does (orders.ts).
async function named(ctx: Ctx, rows: readonly HeaderRow[]) {
  const places = await placeNames(ctx, rows.flatMap((r) => [r.locationId, r.rejectsLocationId]));
  const suppliers = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.supplierId))) suppliers.set(id, (await getPartyById(ctx, { id })).name);
  return rows.map((r) => ({ id: r.id, number: r.number, orderId: r.orderId, orderNumber: r.orderNumber, supplierId: r.supplierId,
    supplierName: suppliers.get(r.supplierId) ?? '', businessDate: r.businessDate, status: r.status as 'draft' | 'posted' | 'cancelled',
    locationId: r.locationId, locationName: places.get(r.locationId) ?? '', rejectsLocationId: r.rejectsLocationId,
    rejectsLocationName: places.get(r.rejectsLocationId) ?? '', supplierRef: r.supplierRef, value: r.value as Money | null }));
}

/** GET /purchasing/receipts (purchasing:read): newest first, a page at a time, the principal's own at `own` scope. */
export async function listReceiptsPage(ctx: Ctx, input: In<typeof listGoodsReceipts>): Promise<Out<typeof listGoodsReceipts>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await purchasingTx(ctx).select(headerCols).from(goodsReceipts).innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.orderId))
    .where(and(
      f.status === undefined ? undefined : eq(goodsReceipts.status, f.status),
      f.supplierId === undefined ? undefined : eq(goodsReceipts.partyId, f.supplierId),
      f.orderId === undefined ? undefined : eq(goodsReceipts.orderId, f.orderId),
      listScope(ctx, 'purchasing:read', goodsReceipts.createdBy),
      after([goodsReceipts.businessDate, goodsReceipts.createdAt, goodsReceipts.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(goodsReceipts.businessDate), desc(goodsReceipts.createdAt), desc(goodsReceipts.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: await named(ctx, page), next: rows.length > input.limit && last !== undefined
    ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null };
}

type Qc = { batches: QcLine['batches']; serials: QcLine['serials'] };

/** GET /purchasing/receipts/:id (purchasing:read): the receipt with its lines, their QC and values. */
export async function getReceiptById(ctx: Ctx, { id }: In<typeof getGoodsReceipt>): Promise<Out<typeof getGoodsReceipt>> {
  const r = await receiptOf(ctx, id, 'purchasing:read');
  // Its PO's number, for a reader who may see that PO (E7).
  const [po] = await purchasingTx(ctx).select({ number: purchaseOrders.number, owner: purchaseOrders.createdBy }).from(purchaseOrders)
    .where(eq(purchaseOrders.id, r.orderId));
  const orderNumber = po !== undefined && ctx.can('purchasing:read', { owner: po.owner }) ? po.number : null;
  const [shown] = await named(ctx, [{ ...r, orderNumber, supplierId: r.partyId }]);
  const lines = await linesOf(ctx, id);
  const ordered = new Map((lines.length === 0 ? [] : await purchasingTx(ctx).select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.qty,
    rate: purchaseOrderLines.rate }).from(purchaseOrderLines).where(inArray(purchaseOrderLines.id, lines.map((l) => l.orderLineId))))
    .map((o) => [o.id, o]));
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  return { ...(shown as NonNullable<typeof shown>), notes: r.notes, lines: lines.map((l) => {
    const qc = l.qc as Qc | null;
    // A posted line's batches and serials as the inspector named them, the receipt's number for those named none.
    const batchNo = (b: string | null) => b ?? r.number ?? '';
    return { id: l.id, lineNo: l.lineNo, orderLineId: l.orderLineId, itemId: l.itemId, sku: labels.get(l.itemId)?.sku ?? '',
      name: labels.get(l.itemId)?.name ?? '', unit: labels.get(l.itemId)?.unit ?? '', rate: l.rate ?? ordered.get(l.orderLineId)?.rate ?? '0',
      ordered: ordered.get(l.orderLineId)?.qty ?? '0', received: l.received, accepted: l.accepted, rejected: l.rejected,
      acceptedValue: l.acceptedValue as Money | null, rejectedValue: l.rejectedValue as Money | null, rejectReason: l.rejectReason,
      batches: (qc?.batches ?? []).map((b) => ({ batchId: '', batchNo: batchNo(b.batchNo), accepted: b.accepted, rejected: b.rejected })),
      serials: (qc?.serials ?? []).map((s) => ({ serialNo: s.serialNo, chassisNo: s.chassisNo, batchNo: batchNo(s.batchNo), rejected: s.rejected })) };
  }) };
}

/**
 * For a purchase bill (M4-03, backend's RAD-138), reached by no route: posted receipt lines as the bill matches them,
 * with what each accrued to Goods Received Not Billed at receipt (`acceptedValue`, `rejectedValue`), which the bill
 * clears exactly. Locked when `forUpdate`, after their POs and before the bill (ADR-008 §12): receipts in id order.
 */
export async function receiptLinesFor(ctx: Ctx, lineIds: readonly string[], o: { forUpdate: boolean }) {
  if (lineIds.length === 0) return [];
  const tx = purchasingTx(ctx);
  const q = tx.select({ id: goodsReceiptLines.id, receiptId: goodsReceipts.id, receiptNumber: goodsReceipts.number,
    receiptDate: goodsReceipts.businessDate, status: goodsReceipts.status, supplierId: goodsReceipts.partyId, orderId: goodsReceipts.orderId,
    orderNumber: purchaseOrders.number, orderLineId: goodsReceiptLines.orderLineId, itemId: goodsReceiptLines.itemId,
    received: goodsReceiptLines.received, accepted: goodsReceiptLines.accepted, rejected: goodsReceiptLines.rejected, rate: goodsReceiptLines.rate,
    acceptedValue: goodsReceiptLines.acceptedValue, rejectedValue: goodsReceiptLines.rejectedValue,
    acceptedMovementId: goodsReceiptLines.acceptedMovementId, rejectedMovementId: goodsReceiptLines.rejectedMovementId,
    locationId: goodsReceipts.locationId, rejectsLocationId: goodsReceipts.rejectsLocationId, owner: goodsReceipts.createdBy })
    .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.orderId))
    // Scoped in the query, so a receipt the caller can't see is neither answered nor locked (auditor-2 on #367).
    .where(and(inArray(goodsReceiptLines.id, [...lineIds]), listScope(ctx, 'purchasing:read', goodsReceipts.createdBy)))
    .orderBy(asc(goodsReceipts.id), asc(goodsReceiptLines.lineNo));
  // Their POs are already locked by the bill (§12), so this takes only their receipts in turn.
  return o.forUpdate ? q.for('update') : q;
}
