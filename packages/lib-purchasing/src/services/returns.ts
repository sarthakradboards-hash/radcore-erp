// Supplier returns (M4-05, RAD-140; ADR-008 §1, §3, §4, §8, §12; ADR-006 §5, §6, F4). A return takes rejects back to
// their supplier out of a rejects place, each line naming the receipt line its goods came in on. Posting sends the goods
// out at the rejects place's average, their units `returned_to_supplier`, and posts Dr Goods Received Not Billed at
// the receipt line's rate, Cr Stock in Hand, any difference to Cost of Goods Sold (F4 and its variant, the architect). It takes what went back off its PO lines' received quantities, so a PO its receipts closed opens again
// and the replacement comes in on the same PO (Sarthak, 23 Nov); a PO closed short stays closed. Cancelling mirrors it.
// Lock order (§12): period → its POs → its receipts → the return → stock → the JV and SR turns → its number.
// shortcut: bills post with RAD-138 PR 3, and their receipt lines with it, so nothing is billed yet and every line is
// unbilled; the billed part (the debit note, at its bill's rates, applied to that bill) joins when bills post.
import { after, purchaseOrderLines, purchasingTx, supplierReturnLines, supplierReturns } from '@radcore/db/purchasing';
import { getPartyById, holdPeriod, JOURNAL_SERIES, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, indiaDate, roundMoney, type Money, type Quantity } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, holdSeries, listScope, momentKey, nextNumber, principalId, type Ctx,
} from '@radcore/lib-platform';
import {
  batchOwners, checkPlace, checkQuantity, holdStock, itemFlags, itemLabels, placeNames, postStock, reverseStock, serialKey, type StockOut,
} from '@radcore/lib-stock';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelSupplierReturn, createSupplierReturn, deleteSupplierReturn, getSupplierReturn, listSupplierReturns, postSupplierReturn,
  updateSupplierReturn,
} from '../contract.ts';
import { linesBilled, lockOrdersFor, receiptSources, receivedOf, returnedOf, settleOrders } from './received.ts';
import { receiptLinesFor } from './receipt-lines.ts';
import { buyingFrom } from './suppliers.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Row = typeof supplierReturns.$inferSelect;
type Draft = Omit<In<typeof createSupplierReturn>, 'supplierId'> & { supplierId: string };
type LineIn = Draft['lines'][number];
type Picks = { batches: LineIn['batches']; serials: LineIn['serials'] };
type ReceiptLine = Awaited<ReturnType<typeof receiptLinesFor>>[number];

/** The returns series (ADR-008 §3): SR/YY-YY/NNNNN, drawn as it posts. */
export const RETURN_SERIES = defineSeries('purchasing.return', 'SR', { digits: 5, label: 'Supplier returns' });

const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const SOURCE = 'supplier_returns';
const today = (): string => indiaDate(new Date());
const refuse = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This return is ${status}, so it can’t be ${what}`);
const sumOf = (xs: readonly string[]) => xs.reduce((s, x) => s.plus(dec(x)), dec('0'));

/** The return within the principal's scope for `key`, by its maker (ADR-008 §13), else not_found; locked to change it. */
async function returnOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = purchasingTx(ctx).select().from(supplierReturns).where(eq(supplierReturns.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw new AppError('not_found', 'There is no such supplier return');
  ctx.see(key, { owner: row.createdBy });
  return row;
}

const linesOf = (ctx: Ctx, id: string) => purchasingTx(ctx).select().from(supplierReturnLines)
  .where(eq(supplierReturnLines.returnId, id)).orderBy(asc(supplierReturnLines.lineNo));
type Line = Awaited<ReturnType<typeof linesOf>>[number];
const asDraftLines = (lines: readonly Line[]): LineIn[] => lines.map((l) => ({ receiptLineId: l.receiptLineId, qty: l.qty as Quantity,
  ...(l.picks as Picks) }));

/**
 * A draft's checks (§4, §8): not after today; the supplier one we buy from; the place a rejects place; each line a posted
 * receipt line of that supplier's, in the principal's scope; its quantity in the item's unit, split over that supplier's
 * own batches of the item, with a serial for each unit of a serialised item; and no receipt line sending back more than
 * came in on it, less what other returns sent, drafts too unless it's posting (`over_received`). Answers its receipt lines.
 */
async function checkDraft(ctx: Ctx, d: Draft, o: { except?: string; posting: boolean }): Promise<Map<string, ReceiptLine>> {
  if (d.businessDate > today()) throw refuse('date_in_future', 'A return can’t be dated after today', ['businessDate']);
  await buyingFrom(ctx, d.supplierId);
  await checkPlace(ctx, d.locationId, { rejects: true });
  const receipt = new Map((await receiptLinesFor(ctx, d.lines.map((l) => l.receiptLineId), { forUpdate: false })).map((r) => [r.id, r]));
  const flags = await itemFlags(ctx, [...receipt.values()].map((r) => r.itemId));
  const owners = await batchOwners(ctx, d.lines.flatMap((l) => l.batches.map((b) => b.batchId)));
  const asked = new Map<string, ReturnType<typeof dec>>();
  const seen = new Set<string>();
  for (const [n, l] of d.lines.entries()) {
    const r = receipt.get(l.receiptLineId);
    if (r === undefined) throw refuse('unknown_receipt_line', 'There is no such goods receipt line', ['lines', n, 'receiptLineId']);
    if (r.status !== 'posted') throw refuse('receipt_not_posted', `That goods receipt is ${r.status}`, ['lines', n, 'receiptLineId']);
    if (r.supplierId !== d.supplierId) throw refuse('other_supplier', 'Those goods came from another supplier', ['lines', n, 'receiptLineId']);
    if (!dec(l.qty).gt(0)) throw refuse('qty_not_positive', 'Enter how many go back', ['lines', n, 'qty']);
    for (const [path, q] of [[['lines', n, 'qty'], l.qty], ...l.batches.map((b, i) => [['lines', n, 'batches', i, 'qty'], b.qty] as const)] as const) {
      await checkQuantity(ctx, r.itemId, q).catch((e: unknown) => { throw e instanceof AppError ? refuse(e.code, e.message, [...path]) : e; });
    }
    if (!sumOf(l.batches.map((b) => b.qty)).eq(dec(l.qty))) {
      throw refuse('batches_mismatch', 'The batches add up to how many go back', ['lines', n, 'batches']);
    }
    for (const [i, b] of l.batches.entries()) {
      const owner = owners.get(b.batchId);
      if (owner?.itemId !== r.itemId || owner.supplierId !== d.supplierId) {
        throw refuse('unknown_batch', 'That isn’t one of this supplier’s batches of the item', ['lines', n, 'batches', i, 'batchId']);
      }
    }
    if (flags.get(r.itemId)?.serialised !== true) {
      if (l.serials.length > 0) throw refuse('not_serialised', 'This item isn’t tracked by serial', ['lines', n, 'serials']);
    } else if (!dec(String(l.serials.length)).eq(dec(l.qty))) {
      throw refuse('serials_mismatch', 'Name a serial for each unit going back', ['lines', n, 'serials']);
    }
    for (const [s, serial] of l.serials.entries()) {
      const key = `${r.itemId} ${serialKey(serial)}`;
      if (seen.has(key)) throw refuse('serial_twice', `${serial} is named twice`, ['lines', n, 'serials', s]);
      seen.add(key);
    }
    asked.set(r.id, (asked.get(r.id) ?? dec('0')).plus(dec(l.qty)));
  }
  // shortcut: a return here sends back only unbilled goods; its billed part, a debit note at its bills' rates, is RAD-140's
  // next PR. Until then a return of goods on a PO line a posted bill names is refused, so none credits Goods Received
  // Not Billed for billed goods whichever lands first (the coordinator, 23 Nov). That PR removes this guard.
  const billed = await linesBilled(ctx, [...receipt.values()].map((r) => r.orderLineId), { posted: true });
  for (const [n, l] of d.lines.entries()) {
    if (billed.has((receipt.get(l.receiptLineId) as ReceiptLine).orderLineId)) {
      throw refuse('return_billed', 'These goods are on a posted bill: returning billed goods, with their debit note, comes next',
        ['lines', n, 'receiptLineId']);
    }
  }
  const back = await returnedOf(ctx, [...asked.keys()], { drafts: !o.posting, ...(o.except === undefined ? {} : { except: o.except }) });
  for (const [n, l] of d.lines.entries()) {
    const r = receipt.get(l.receiptLineId) as ReceiptLine;
    const left = dec(r.received).minus(back.get(r.id) ?? dec('0'));
    if ((asked.get(r.id) ?? dec('0')).gt(left)) {
      throw refuse('over_received', `Only ${left.toFixed()} of that receipt line is left to send back`, ['lines', n, 'qty']);
    }
  }
  return receipt;
}

const writeLines = async (ctx: Ctx, returnId: string, d: Draft, receipt: Map<string, ReceiptLine>) => {
  await purchasingTx(ctx).insert(supplierReturnLines).values(d.lines.map((l, i) => ({ returnId, lineNo: i + 1, receiptLineId: l.receiptLineId,
    itemId: receipt.get(l.receiptLineId)?.itemId ?? '', qty: l.qty, picks: { batches: l.batches, serials: l.serials } })));
};
const header = (d: Draft) => ({ businessDate: d.businessDate, locationId: d.locationId, reason: d.reason, notes: d.notes });

/** POST /purchasing/returns (supplier_returns:write): a new draft. */
export async function addReturn(ctx: Ctx, input: In<typeof createSupplierReturn>): Promise<Out<typeof createSupplierReturn>> {
  const receipt = await checkDraft(ctx, input, { posting: false });
  const [row] = await purchasingTx(ctx).insert(supplierReturns).values({ partyId: input.supplierId, ...header(input) })
    .returning({ id: supplierReturns.id });
  if (row === undefined) throw new Error('the supplier return was not stored');
  await writeLines(ctx, row.id, input, receipt);
  return { id: row.id };
}

/** PUT /purchasing/returns/:id (supplier_returns:write): a draft rewritten whole. */
export async function changeReturn(ctx: Ctx, { id, ...input }: In<typeof updateSupplierReturn>): Promise<Out<typeof updateSupplierReturn>> {
  const r = await returnOf(ctx, id, 'supplier_returns:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'changed');
  const d = { ...input, supplierId: r.partyId };
  const receipt = await checkDraft(ctx, d, { except: id, posting: false });
  const tx = purchasingTx(ctx);
  await tx.update(supplierReturns).set(header(d)).where(eq(supplierReturns.id, id));
  await tx.delete(supplierReturnLines).where(eq(supplierReturnLines.returnId, id));
  await writeLines(ctx, id, d, receipt);
  return {};
}

/** DELETE /purchasing/returns/:id (supplier_returns:write): a draft thrown away. */
export async function dropReturn(ctx: Ctx, { id }: In<typeof deleteSupplierReturn>): Promise<Out<typeof deleteSupplierReturn>> {
  const r = await returnOf(ctx, id, 'supplier_returns:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'deleted: cancel it instead');
  await purchasingTx(ctx).delete(supplierReturns).where(eq(supplierReturns.id, id));
  return {};
}

/** The POs these receipt lines came in on, locked first (§12), to settle once the return posts or is cancelled. */
const lockOrders = async (ctx: Ctx, lines: readonly Line[]) => {
  const sources = await receiptSources(ctx, lines.map((l) => l.receiptLineId));
  return { sources, orders: await lockOrdersFor(ctx, [...sources.values()].map((x) => x.orderId)) };
};

/** POST /purchasing/returns/:id/post (supplier_returns:write): the goods back to their supplier (§8, F4). */
export async function postReturn(ctx: Ctx, { id }: In<typeof postSupplierReturn>): Promise<Out<typeof postSupplierReturn>> {
  // §12: the period first, so read the draft unlocked to learn its date and sources, then lock its POs, its receipts, itself.
  const seen = await returnOf(ctx, id, 'supplier_returns:write');
  if (seen.status !== 'draft') throw wrongStatus(seen.status, 'posted');
  await holdPeriod(ctx, seen.businessDate);
  const first = await linesOf(ctx, id);
  const { orders } = await lockOrders(ctx, first);
  await receiptLinesFor(ctx, first.map((l) => l.receiptLineId), { forUpdate: true });
  const r = await returnOf(ctx, id, 'supplier_returns:write', true);
  if (r.status !== 'draft') throw wrongStatus(r.status, 'posted');
  const lines = await linesOf(ctx, id);
  const draft = { ...r, supplierId: r.partyId, lines: asDraftLines(lines) };
  const receipt = await checkDraft(ctx, draft, { except: id, posting: true });
  for (const [n, l] of lines.entries()) {
    const came = receipt.get(l.receiptLineId)?.receiptDate ?? r.businessDate;
    if (r.businessDate < came) throw refuse('date_before_source', `Those goods came in on ${came}`, ['lines', n, 'receiptLineId']);
  }
  const picks = (l: Line) => l.picks as Picks;
  await holdStock(ctx, lines.map((l) => ({ itemId: l.itemId, locationId: r.locationId, serials: picks(l).serials })));
  await holdSeries(ctx, [JOURNAL_SERIES, RETURN_SERIES]);
  const number = await nextNumber(ctx, RETURN_SERIES, r.businessDate);
  const outs: StockOut[] = lines.map((l) => ({ itemId: l.itemId, locationId: r.locationId, sourceLineId: l.id, qty: l.qty as Quantity,
    batches: picks(l).batches.map((b) => ({ batchId: b.batchId, qty: b.qty as Quantity })),
    units: picks(l).serials.map((serialNo) => ({ serialNo })), unitEvent: 'returned_to_supplier' }));
  const moved = (await postStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate: r.businessDate, outs }))
    .filter((m) => m.direction === 'out');
  // The architect on RAD-140: the goods leave at the rejects place's average (the stock side), while Goods Received Not
  // Billed gets back what it accrued, the receipt line's rate × quantity (F4). Any difference goes to Cost of Goods Sold,
  // as a bill's price difference on goods no longer on hand does (ADR-006 §4).
  const rateOf = (l: Line) => receipt.get(l.receiptLineId)?.rate ?? '0';
  const accrued = lines.map((l) => roundMoney(dec(l.qty).times(dec(rateOf(l)))));
  const value = roundMoney(accrued.reduce((s, v) => s.plus(dec(v)), dec('0')));
  const out = moved.reduce((s, m) => s.plus(dec(m.value)), dec('0'));
  const stock: JournalLine[] = moved.filter((m) => dec(m.value).gt(0))
    .map((m) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId, credit: m.value }));
  const gap = dec(value).minus(out);
  const entryLines: JournalLine[] = [
    ...(dec(value).gt(0) ? [{ account: { system: 'grni' }, debit: value }] : []),
    ...stock,
    ...(gap.isZero() ? [] : [{ account: { system: 'cogs' }, ...(gap.gt(0) ? { credit: roundMoney(gap) } : { debit: roundMoney(gap.neg()) }) }]),
  ];
  // Free goods (rate 0, at nothing on the shelf) carry no value, and post no entry: an entry has two lines or more.
  const entry = entryLines.length < 2 ? null : await postEntry(ctx, { kind: 'supplier_return', businessDate: r.businessDate,
    source: { table: SOURCE, id }, lines: entryLines });
  const tx = purchasingTx(ctx);
  for (const [i, l] of lines.entries()) {
    const m = moved[i];
    await tx.update(supplierReturnLines).set({ rate: rateOf(l), unbilledQty: l.qty, unbilledValue: accrued[i] ?? '0.00', movementId: m?.id ?? null })
      .where(eq(supplierReturnLines.id, l.id));
  }
  await tx.update(supplierReturns).set({ status: 'posted', number, unbilledValue: value, postedEntryId: entry?.id ?? null })
    .where(eq(supplierReturns.id, id));
  await settleOrders(ctx, orders);
  return { number, debitNoteNumber: null };
}

/** POST /purchasing/returns/:id/cancel (supplier_returns:write): its mirror, dated the cancellation's day; its units back
 * at the rejects place as `received`, and its PO lines' received quantities back up, unless the replacement has come in
 * on the PO since (`replacement_received`). */
export async function cancelReturnNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelSupplierReturn>): Promise<Out<typeof cancelSupplierReturn>> {
  await holdPeriod(ctx, businessDate);
  await returnOf(ctx, id, 'supplier_returns:write');
  const first = await linesOf(ctx, id);
  // Every receipt line the return names, whoever made the receipt: the return is the canceller's, so its POs are locked,
  // checked and settled whatever the canceller may read (auditor-2 on #379).
  const { sources, orders } = await lockOrders(ctx, first);
  const r = await returnOf(ctx, id, 'supplier_returns:write', true);
  if (r.status !== 'posted') throw wrongStatus(r.status, 'cancelled');
  if (businessDate > today()) throw refuse('date_in_future', 'A cancellation can’t be dated after today', ['businessDate']);
  if (businessDate < r.businessDate) throw refuse('date_before_source', `The return is dated ${r.businessDate}`, ['businessDate']);
  const back = new Map<string, ReturnType<typeof dec>>();
  for (const l of first) {
    const orderLineId = sources.get(l.receiptLineId)?.orderLineId;
    if (orderLineId !== undefined) back.set(orderLineId, (back.get(orderLineId) ?? dec('0')).plus(dec(l.qty)));
  }
  const got = await receivedOf(ctx, [...back.keys()], { drafts: false });
  const ordered = back.size === 0 ? [] : await purchasingTx(ctx).select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.qty })
    .from(purchaseOrderLines).where(inArray(purchaseOrderLines.id, [...back.keys()]));
  for (const o of ordered) {
    if ((got.get(o.id) ?? dec('0')).plus(back.get(o.id) ?? dec('0')).gt(dec(o.qty))) {
      throw new AppError('replacement_received', 'The replacement for these goods has come in on the purchase order since, so this return can’t be undone');
    }
  }
  await reverseStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate });
  const [own] = r.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: SOURCE, id }, businessDate, reason });
  await purchasingTx(ctx).update(supplierReturns).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(supplierReturns.id, id));
  await settleOrders(ctx, orders);
  return {};
}

type HeaderRow = { id: string; number: string | null; partyId: string; businessDate: string; status: string; locationId: string };

// Names for a page of returns. shortcut: one read per distinct supplier on the page, as the receipts list does.
async function named(ctx: Ctx, rows: readonly HeaderRow[]) {
  const places = await placeNames(ctx, rows.map((r) => r.locationId));
  const suppliers = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.partyId))) suppliers.set(id, (await getPartyById(ctx, { id })).name);
  return rows.map((r) => ({ id: r.id, number: r.number, supplierId: r.partyId, supplierName: suppliers.get(r.partyId) ?? '',
    businessDate: r.businessDate, status: r.status as 'draft' | 'posted' | 'cancelled', locationId: r.locationId,
    locationName: places.get(r.locationId) ?? '', debitNoteNumber: null, debitTotal: null }));
}

/** GET /purchasing/returns (purchasing:read): newest first, a page at a time, the principal's own at `own` scope. */
export async function listReturnsPage(ctx: Ctx, input: In<typeof listSupplierReturns>): Promise<Out<typeof listSupplierReturns>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await purchasingTx(ctx).select({ id: supplierReturns.id, number: supplierReturns.number, partyId: supplierReturns.partyId,
    businessDate: supplierReturns.businessDate, status: supplierReturns.status, locationId: supplierReturns.locationId,
    createdAt: supplierReturns.createdAt }).from(supplierReturns)
    .where(and(
      f.status === undefined ? undefined : eq(supplierReturns.status, f.status),
      f.supplierId === undefined ? undefined : eq(supplierReturns.partyId, f.supplierId),
      listScope(ctx, 'purchasing:read', supplierReturns.createdBy),
      after([supplierReturns.businessDate, supplierReturns.createdAt, supplierReturns.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(supplierReturns.businessDate), desc(supplierReturns.createdAt), desc(supplierReturns.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: await named(ctx, page), next: rows.length > input.limit && last !== undefined
    ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null };
}

/** GET /purchasing/returns/:id (purchasing:read): the return with its lines, each split. Unbilled values are what Goods
 * Received Not Billed gets back, the receipt line's rate × quantity, worked out on read while a draft, stored once posted. */
export async function getReturnById(ctx: Ctx, { id }: In<typeof getSupplierReturn>): Promise<Out<typeof getSupplierReturn>> {
  const r = await returnOf(ctx, id, 'purchasing:read');
  const [shown] = await named(ctx, [r]);
  const lines = await linesOf(ctx, id);
  // Its receipt lines in the reader's scope (E7): one they can't see shows no receipt number.
  const receipt = new Map((await receiptLinesFor(ctx, lines.map((l) => l.receiptLineId), { forUpdate: false })).map((x) => [x.id, x]));
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  const numbers = await batchOwners(ctx, lines.flatMap((l) => (l.picks as Picks).batches.map((b) => b.batchId)));
  const out = lines.map((l) => {
    const src = receipt.get(l.receiptLineId);
    const rate = l.rate ?? src?.rate ?? '0';
    const p = l.picks as Picks;
    return { id: l.id, lineNo: l.lineNo, receiptLineId: l.receiptLineId, receiptId: src?.receiptId ?? null, receiptNumber: src?.receiptNumber ?? null,
      orderLineId: src?.orderLineId ?? null, itemId: l.itemId, sku: labels.get(l.itemId)?.sku ?? '', name: labels.get(l.itemId)?.name ?? '',
      unit: labels.get(l.itemId)?.unit ?? '', qty: l.qty,
      batches: p.batches.map((b) => ({ batchId: b.batchId, batchNo: numbers.get(b.batchId)?.batchNo ?? '', qty: b.qty })), serials: p.serials,
      rate, unbilledQty: l.unbilledQty ?? l.qty, unbilledValue: (l.unbilledValue ?? roundMoney(dec(l.qty).times(dec(rate)))) as Money,
      billed: [] };
  });
  return { ...(shown as NonNullable<typeof shown>), reason: r.reason, notes: r.notes, lines: out,
    unbilledValue: (r.unbilledValue ?? roundMoney(out.reduce((s, l) => s.plus(dec(l.unbilledValue)), dec('0')))) as Money,
    debitNote: null, amountsNote: null, applications: [], cancelReason: r.cancelReason };
}
