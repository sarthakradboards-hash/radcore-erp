// Purchase orders (M4-01, RAD-136; ADR-008 §1, §3, §4, §5, §12, §13): a supplier, its lines and their tax. A draft
// changes freely and is thrown away freely. Placing compares its total with GST with the placer's limit: within it, it's
// placed at once (numbered PO, last); above it, someone else holding purchasing:approve decides, and approving places
// it. A placed PO's lines may change, but a raise past what was approved or the placer's limit is refused
// (over_approved, the architect on RAD-136). It posts nothing to the books.
import { after, purchaseOrderLines, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { BUYS_FROM_KINDS, getCompanyProfile, getPartyById, holdPeriod } from '@radcore/lib-accounts';
import { dec, indiaDate, type Money } from '@radcore/lib-common';
import { gstRateFor, lineTax, placeOfSupply, totalsOf, type LineTax, type Totals } from '@radcore/lib-gst';
import {
  AppError, awaitingApproval, decodeCursor, defineSeries, encodeCursor, listScope, momentKey, nextNumber, requestApproval,
  withdrawPending, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { checkQuantity, itemLabels } from '@radcore/lib-stock';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelPurchaseOrder, closePurchaseOrder, createPurchaseOrder, deletePurchaseOrder, getPurchaseOrder, listPurchaseOrders, placePurchaseOrder,
  updatePurchaseOrder,
} from '../contract.ts';
import { orderLimitOf } from './order-limits.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'placed' | 'closed' | 'cancelled';
type LineIn = { itemId: string; qty: string; rate: string };
type Row = typeof purchaseOrders.$inferSelect;
type LineAmounts = Out<typeof getPurchaseOrder>['lines'][number]['amounts'];

/** The PO series (ADR-008 §3): PO/YY-YY/NNNNN, drawn as the last step of placing. */
export const ORDER_SERIES = defineSeries('purchasing.order', 'PO', { digits: 5, label: 'Purchase orders' });

// Newest first: by date, then the moment each was made, then id (as sales orders page).
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const notFound = () => new AppError('not_found', 'There is no such purchase order');
const today = (): string => indiaDate(new Date());
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This purchase order is ${status}, so it can’t be ${what}`);

/** The PO within the principal's scope for `key`, by its maker (ADR-008 §13), else not_found; locked when it's to change. */
async function orderOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = purchasingTx(ctx).select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  ctx.see(key, { owner: row.createdBy });
  return row;
}

/** The supplier, if it's one we buy from and switched on (ADR-008 §5). Answers its name and state. */
async function buyingFrom(ctx: Ctx, partyId: string): Promise<{ name: string; stateCode: string }> {
  const party = await getPartyById(ctx, { id: partyId }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'not_found') {
      throw new AppError('unknown_party', 'There is no such party', [{ path: ['supplierId'], code: 'unknown', message: 'Choose a supplier' }]);
    }
    throw e;
  });
  if (!party.active || !party.kinds.some((k) => (BUYS_FROM_KINDS as readonly string[]).includes(k))) {
    throw new AppError('not_a_supplier', `${party.name} isn’t a supplier we buy from`,
      [{ path: ['supplierId'], code: 'not_a_supplier', message: party.active ? 'Choose a supplier' : 'This party is switched off' }]);
  }
  return { name: party.name, stateCode: party.stateCode };
}

/** Each line's item exists, is switched on, and its quantity fits its unit (RC-162). */
async function checkLines(ctx: Ctx, lines: readonly LineIn[]): Promise<void> {
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  for (const [n, line] of lines.entries()) {
    const item = labels.get(line.itemId);
    if (item === undefined) {
      throw new AppError('unknown_item', 'One of these items doesn’t exist', [{ path: ['lines', n, 'itemId'], code: 'unknown', message: 'Choose an item' }]);
    }
    if (!item.active) {
      throw new AppError('item_inactive', `${item.name} is switched off`, [{ path: ['lines', n, 'itemId'], code: 'item_inactive', message: 'Choose an item that’s switched on' }]);
    }
    await checkQuantity(ctx, line.itemId, line.qty).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
    });
  }
}

/** A draft's date: not after today (ADR-008 §4). The year and the period lock are judged when it's placed. */
function checkDraftDate(businessDate: string): void {
  if (businessDate > today()) {
    throw new AppError('date_in_future', 'The date is after today', [{ path: ['businessDate'], code: 'date_in_future', message: 'Use today or earlier' }]);
  }
}

type Priced = LineTax & { gstRate: string; gstRateSource: string };
/** A PO's tax, worked out by lib-gst as a sale's is (ADR-008 §5): the supplier sells, we buy, so the place of supply is
 * ours and the tax is CGST and SGST when the supplier is in our state, IGST otherwise. Refused while our profile isn't set
 * (`company_profile_incomplete`) or an item has no GST rate on the date (`no_gst_rate`). */
async function amountsOf(ctx: Ctx, supplierState: string, on: string, lines: readonly LineIn[]):
  Promise<{ placeOfSupply: string; lines: Priced[]; totals: Totals }> {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) {
    throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state before placing a purchase order');
  }
  const place = placeOfSupply(supplierState, company.stateCode, null);
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  const priced: Priced[] = [];
  for (const [n, l] of lines.entries()) {
    const rate = await gstRateFor(ctx, labels.get(l.itemId)?.hsn ?? '', on).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'itemId'], code: e.code, message: e.message }]) : e;
    });
    priced.push({ ...lineTax({ ...l, discountPercent: '0', gstPercent: rate.rate }, place.intraState), gstRate: rate.rate, gstRateSource: rate.source });
  }
  return { placeOfSupply: place.state, lines: priced, totals: totalsOf(priced) };
}

const frozenHeader = (a: Awaited<ReturnType<typeof amountsOf>>) => ({ placeOfSupply: a.placeOfSupply, taxable: a.totals.taxable,
  cgst: a.totals.cgst, sgst: a.totals.sgst, igst: a.totals.igst, roundOff: a.totals.roundOff, total: a.totals.total });
const frozenLine = (l: Priced) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable, cgst: l.cgst,
  sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal });

const linesOf = async (ctx: Ctx, id: string) => purchasingTx(ctx).select().from(purchaseOrderLines)
  .where(eq(purchaseOrderLines.orderId, id)).orderBy(asc(purchaseOrderLines.lineNo));

/** Writes a PO's lines afresh, numbered from 1 in the order sent, with their stored tax when it's placed. */
async function writeLines(ctx: Ctx, orderId: string, lines: readonly LineIn[], priced: readonly Priced[] | null): Promise<void> {
  const tx = purchasingTx(ctx);
  await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
  await tx.insert(purchaseOrderLines).values(lines.map((l, i) => {
    const p = priced?.[i];
    return { orderId, lineNo: i + 1, itemId: l.itemId, qty: l.qty, rate: l.rate, ...(p === undefined ? {} : frozenLine(p)) };
  }));
}

/** What the approver sees and approves (RAD-38): the supplier, the date and the lines, and their total with GST. */
type Version = { supplierId: string; businessDate: string; lines: { itemId: string; qty: string; rate: string }[]; total: string | null };

/** The PO approval's spec (ADR-008 §5): kind purchase-order, under purchasing:approve. Placing posts nothing, so it has
 * no lockFirst; approving places the PO. */
export const orderApproval: ApprovalSpec<Version> = {
  kind: 'purchase-order',
  table: 'purchase_orders',
  parts: ['purchase_order_lines'],
  async version(ctx, id, { forUpdate }) {
    const q = purchasingTx(ctx).select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    const [o] = forUpdate ? await q.for('update') : await q;
    // Its maker asks (purchasing:write) and someone else decides (purchasing:approve); outside both, there's no such PO.
    // Its status isn't part of it: approving places it, which changes no figure approved (ADR-001 §8b), and approved()
    // refuses one no longer a draft.
    if (o === undefined) return null;
    if (!ctx.can('purchasing:write', { owner: o.createdBy }) && !ctx.can('purchasing:approve', { owner: o.createdBy })) return null;
    const lines = (await linesOf(ctx, id)).map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate }));
    // It refuses nothing: the approver's queue reads it for every request, and approving re-checks (approved()). A total
    // that can't be worked out now hashes as null, so approving answers version_changed.
    const supplier = await getPartyById(ctx, { id: o.partyId });
    const amounts = await amountsOf(ctx, supplier.stateCode, o.businessDate, lines).catch(() => null);
    return { supplierId: o.partyId, businessDate: o.businessDate, lines, total: amounts?.totals.total ?? null };
  },
  // The engine has locked the PO. The period's re-check takes it FOR SHARE after that, against ADR-006 §1's order, but
  // nothing that locks the period FOR UPDATE then locks a PO, so no two saves wait on each other in a circle.
  async approved(ctx, id) {
    await place(ctx, await orderOf(ctx, id, 'purchasing:approve', true), true);
  },
  // A refused one stays a draft: its maker changes it or lets it be.
  async rejected() {},
};

/** Places a locked draft: its date against the year and the period lock, its supplier and lines again, its tax stored,
 * then its number drawn last. `approved`: by the approval's decision, which records what it approved. */
async function place(ctx: Ctx, o: Row, approved: boolean): Promise<string> {
  if (o.status !== 'draft') throw wrongStatus(o.status, 'placed');
  await holdPeriod(ctx, o.businessDate);
  const supplier = await buyingFrom(ctx, o.partyId);
  const lines = await linesOf(ctx, o.id);
  await checkLines(ctx, lines);
  const amounts = await amountsOf(ctx, supplier.stateCode, o.businessDate, lines);
  // Each line keeps its id; its tax is stored beside it (the lines are numbered from 1 in order, as linesOf reads them).
  for (const [i, l] of amounts.lines.entries()) {
    await purchasingTx(ctx).update(purchaseOrderLines).set(frozenLine(l))
      .where(and(eq(purchaseOrderLines.orderId, o.id), eq(purchaseOrderLines.lineNo, i + 1)));
  }
  const number = await nextNumber(ctx, ORDER_SERIES, o.businessDate);
  await purchasingTx(ctx).update(purchaseOrders).set({ ...frozenHeader(amounts), status: 'placed', number,
    ...(approved ? { approvedTotal: amounts.totals.total } : {}) }).where(eq(purchaseOrders.id, o.id));
  return number;
}

/** GET /purchasing/orders (purchasing:read): newest first, a page at a time, the principal's own where that's their scope. */
export async function listOrdersPage(ctx: Ctx, input: In<typeof listPurchaseOrders>): Promise<Out<typeof listPurchaseOrders>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await purchasingTx(ctx).select({ id: purchaseOrders.id, number: purchaseOrders.number, partyId: purchaseOrders.partyId,
    businessDate: purchaseOrders.businessDate, expectedBy: purchaseOrders.expectedBy, status: purchaseOrders.status, total: purchaseOrders.total,
    createdAt: purchaseOrders.createdAt }).from(purchaseOrders).where(and(
    input.filter.status === undefined ? undefined : eq(purchaseOrders.status, input.filter.status),
    input.filter.supplierId === undefined ? undefined : eq(purchaseOrders.partyId, input.filter.supplierId),
    listScope(ctx, 'purchasing:read', purchaseOrders.createdBy),
    after([purchaseOrders.businessDate, purchaseOrders.createdAt, purchaseOrders.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(purchaseOrders.businessDate), desc(purchaseOrders.createdAt), desc(purchaseOrders.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = new Map<string, string>();
  for (const id of new Set(page.map((r) => r.partyId))) names.set(id, (await getPartyById(ctx, { id })).name);
  const waiting = await awaitingApproval(ctx, orderApproval, page.map((r) => r.id));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, number: r.number, supplierId: r.partyId, supplierName: names.get(r.partyId) ?? '',
      businessDate: r.businessDate, expectedBy: r.expectedBy, status: r.status as Status, total: r.total as Money | null,
      awaitingApproval: waiting.has(r.id) })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /purchasing/orders/:id (purchasing:read): with its lines, a draft's tax worked out now, a placed one's as stored. */
export async function getOrderById(ctx: Ctx, { id }: In<typeof getPurchaseOrder>): Promise<Out<typeof getPurchaseOrder>> {
  const o = await orderOf(ctx, id, 'purchasing:read');
  const lines = await linesOf(ctx, id);
  const supplier = await getPartyById(ctx, { id: o.partyId });
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  const none = { cgst: null, sgst: null, igst: null };
  let header: Out<typeof getPurchaseOrder>['amounts'];
  let lineAmounts: LineAmounts[];
  if (o.status === 'draft') {
    const worked = await amountsOf(ctx, supplier.stateCode, o.businessDate, lines).catch((e: unknown) => {
      if (e instanceof AppError && (e.code === 'company_profile_incomplete' || e.code === 'no_gst_rate')) return e;
      throw e;
    });
    if (worked instanceof AppError) {
      const taxed = lines.map((l) => lineTax({ ...l, discountPercent: '0', gstPercent: '0' }, true).taxable);
      header = { placeOfSupply: null, taxable: taxed.reduce((s, t) => s.plus(dec(t)), dec('0')).toFixed(2), ...none, roundOff: null, total: null,
        note: worked.code === 'company_profile_incomplete' ? 'Set the company’s state to work out the GST' : worked.message };
      lineAmounts = taxed.map((taxable) => ({ gstRate: null, gstRateSource: null, taxable, ...none, lineTotal: null }));
    } else {
      header = { ...frozenHeader(worked), note: null };
      lineAmounts = worked.lines.map(frozenLine);
    }
  } else {
    header = { placeOfSupply: o.placeOfSupply, taxable: o.taxable ?? '0.00', cgst: o.cgst, sgst: o.sgst, igst: o.igst, roundOff: o.roundOff,
      total: o.total, note: null };
    lineAmounts = lines.map((l) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable ?? '0.00', cgst: l.cgst,
      sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal }));
  }
  const waiting = await awaitingApproval(ctx, orderApproval, [id]);
  return {
    id: o.id, number: o.number, supplierId: o.partyId, supplierName: supplier.name, businessDate: o.businessDate, expectedBy: o.expectedBy,
    status: o.status as Status, total: o.total as Money | null, awaitingApproval: waiting.has(id), notes: o.notes, amounts: header,
    approvedTotal: o.approvedTotal as Money | null, closedReason: o.closeReason,
    // What has come in against each line: receipts are M4-02's, so nothing yet.
    lines: lines.map((l, i) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, qty: l.qty, rate: l.rate, sku: labels.get(l.itemId)?.sku ?? '',
      name: labels.get(l.itemId)?.name ?? '', unit: labels.get(l.itemId)?.unit ?? '', received: '0',
      amounts: lineAmounts[i] ?? { gstRate: null, gstRateSource: null, taxable: '0.00', ...none, lineTotal: null } })),
  };
}

/** POST /purchasing/orders (purchasing:write): a new draft. */
export async function addOrder(ctx: Ctx, input: In<typeof createPurchaseOrder>): Promise<Out<typeof createPurchaseOrder>> {
  checkDraftDate(input.businessDate);
  await buyingFrom(ctx, input.supplierId);
  await checkLines(ctx, input.lines);
  const [row] = await purchasingTx(ctx).insert(purchaseOrders).values({ partyId: input.supplierId, businessDate: input.businessDate,
    expectedBy: input.expectedBy, notes: input.notes }).returning({ id: purchaseOrders.id });
  if (row === undefined) throw new Error('the purchase order was not stored');
  await writeLines(ctx, row.id, input.lines, null);
  return { id: row.id };
}

/** PUT /purchasing/orders/:id (purchasing:write): a draft rewritten whole, or a placed PO's lines changed (ADR-008 §5). */
export async function changeOrder(ctx: Ctx, { id, ...input }: In<typeof updatePurchaseOrder>): Promise<Out<typeof updatePurchaseOrder>> {
  const o = await orderOf(ctx, id, 'purchasing:write', true);
  if (o.status !== 'draft' && o.status !== 'placed') throw wrongStatus(o.status, 'changed');
  checkDraftDate(input.businessDate);
  await checkLines(ctx, input.lines);
  if (o.status === 'draft') {
    await buyingFrom(ctx, input.supplierId);
    await purchasingTx(ctx).update(purchaseOrders).set({ partyId: input.supplierId, businessDate: input.businessDate, expectedBy: input.expectedBy,
      notes: input.notes }).where(eq(purchaseOrders.id, id));
    await writeLines(ctx, id, input.lines, null);
    return {};
  }
  // A placed PO keeps its supplier and date: its number and any approval were given for them (the auditor on #333).
  if (input.supplierId !== o.partyId || input.businessDate !== o.businessDate) {
    throw new AppError('fixed_once_placed', 'A placed purchase order keeps its supplier and date: close it short and raise another',
      [{ path: [input.supplierId !== o.partyId ? 'supplierId' : 'businessDate'], code: 'fixed_once_placed', message: 'This can’t change once placed' }]);
  }
  // shortcut: nothing can be received until M4-02's goods receipts exist, so no line is below what has come in
  // (po_received); M4-02 checks each line's new quantity against its received quantity here. Its lines are written afresh,
  // with new ids, which M4-02 changes to an update by line once a receipt line points at one.
  const supplier = await buyingFrom(ctx, o.partyId);
  const amounts = await amountsOf(ctx, supplier.stateCode, o.businessDate, input.lines);
  const now = dec(o.total ?? '0');
  const next = dec(amounts.totals.total);
  // A raise past what its approval was given for, or past the placer's limit where it needed none, is refused; lowering
  // it, or a change within that bound, saves (the architect on RAD-136).
  const bound = o.approvedTotal ?? await orderLimitOf(ctx);
  if (next.gt(now) && next.gt(dec(bound))) {
    throw new AppError('over_approved', 'This raises the purchase order past what was approved: put the extra goods on a new purchase order',
      [{ path: ['lines'], code: 'over_approved', message: `The total would be ${amounts.totals.total}` }]);
  }
  await purchasingTx(ctx).update(purchaseOrders).set({ expectedBy: input.expectedBy, notes: input.notes, ...frozenHeader(amounts) })
    .where(eq(purchaseOrders.id, id));
  await writeLines(ctx, id, input.lines, amounts.lines);
  return {};
}

/** DELETE /purchasing/orders/:id (purchasing:write): a draft thrown away, any request for its approval closed first. */
export async function dropOrder(ctx: Ctx, { id }: In<typeof deletePurchaseOrder>): Promise<Out<typeof deletePurchaseOrder>> {
  const o = await orderOf(ctx, id, 'purchasing:write', true);
  if (o.status !== 'draft') throw wrongStatus(o.status, 'deleted: cancel it instead');
  await withdrawPending(ctx, orderApproval, id);
  await purchasingTx(ctx).delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  return {};
}

/** POST /purchasing/orders/:id/place (purchasing:write): at once within the placer's limit, else by asking for approval. */
export async function placeOrder(ctx: Ctx, { id }: In<typeof placePurchaseOrder>): Promise<Out<typeof placePurchaseOrder>> {
  // ADR-006 §1: the period first, so read the draft's date unlocked, hold the period, then lock the PO and look again.
  const seen = await orderOf(ctx, id, 'purchasing:write');
  if (seen.status !== 'draft') throw wrongStatus(seen.status, 'placed');
  await holdPeriod(ctx, seen.businessDate);
  const o = await orderOf(ctx, id, 'purchasing:write', true);
  if (o.status !== 'draft') throw wrongStatus(o.status, 'placed');
  const supplier = await buyingFrom(ctx, o.partyId);
  const lines = await linesOf(ctx, id);
  await checkLines(ctx, lines);
  const amounts = await amountsOf(ctx, supplier.stateCode, o.businessDate, lines);
  if (dec(amounts.totals.total).lte(dec(await orderLimitOf(ctx)))) {
    return { status: 'placed', number: await place(ctx, o, false), approvalId: null, versionHash: null };
  }
  const asked = await requestApproval(ctx, orderApproval, id);
  return { status: 'pending_approval', number: null, approvalId: asked.id, versionHash: asked.versionHash };
}

/** POST /purchasing/orders/:id/close (purchasing:write): a placed PO closed short, with the reason. */
export async function closeOrder(ctx: Ctx, { id, reason }: In<typeof closePurchaseOrder>): Promise<Out<typeof closePurchaseOrder>> {
  const o = await orderOf(ctx, id, 'purchasing:write', true);
  if (o.status !== 'placed') throw wrongStatus(o.status, 'closed');
  await purchasingTx(ctx).update(purchaseOrders).set({ status: 'closed', closeReason: reason }).where(eq(purchaseOrders.id, id));
  return {};
}

/** POST /purchasing/orders/:id/cancel (purchasing:write): a draft or placed PO cancelled, while nothing has come in. */
export async function cancelOrder(ctx: Ctx, { id, reason }: In<typeof cancelPurchaseOrder>): Promise<Out<typeof cancelPurchaseOrder>> {
  const o = await orderOf(ctx, id, 'purchasing:write', true);
  if (o.status !== 'draft' && o.status !== 'placed') throw wrongStatus(o.status, 'cancelled');
  // shortcut: nothing can be received until M4-02, so nothing refuses po_received yet; M4-02 checks it here.
  if (o.status === 'draft') await withdrawPending(ctx, orderApproval, id);
  await purchasingTx(ctx).update(purchaseOrders).set({ status: 'cancelled', closeReason: reason }).where(eq(purchaseOrders.id, id));
  return {};
}
