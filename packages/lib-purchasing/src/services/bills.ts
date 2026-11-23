// Purchase bills (M4-03, RAD-138; ADR-008 §4, §7, §7a): a supplier's own invoice entered as a draft, with its file,
// the supplier's number, date and GSTIN as printed, its goods lines (each a PO line) and its charges. The duplicate
// check is the database's unique index, over every bill not cancelled. A draft's tax is worked out on read, from its own
// lines at the rates in force on the supplier's invoice date (RC-056), and how each line stands against its PO rate.
// Posting, the three-way match against receipts and the approval join with M4-02's goods receipts (RAD-138 PR 3).
import { after, purchaseBillLines, purchaseBills, purchaseOrderLines, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { dec, indiaDate, percentString, roundMoney, type Decimal, type Money } from '@radcore/lib-common';
import { gstRateFor, lineTax, placeOfSupply, totalsOf, type LineTax } from '@radcore/lib-gst';
import {
  AppError, decodeCursor, defineSeries, defineSetting, encodeCursor, listScope, momentKey, readyFile, type Ctx,
} from '@radcore/lib-platform';
import { checkQuantity, itemLabels } from '@radcore/lib-stock';
import { and, asc, desc, eq, inArray, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { createPurchaseBill, deletePurchaseBill, getPurchaseBill, listPurchaseBills, updatePurchaseBill } from '../contract.ts';
import { receiptLinesFor } from './receipts.ts';
import { buyingFrom } from './suppliers.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'posted' | 'cancelled';
type BillIn = In<typeof createPurchaseBill>;
type LineIn = BillIn['lines'][number];
type Row = typeof purchaseBills.$inferSelect;
type BillOut = Out<typeof getPurchaseBill>;
type LineAmounts = BillOut['lines'][number]['amounts'];

/** Bills' numbers (ADR-008 §3): PB/YY-YY/NNNNN, drawn as the last step of posting. */
export const BILL_SERIES = defineSeries('purchasing.bill', 'PB', { digits: 5, label: 'Purchase bills' });

/** How far above its PO rate a line may be billed, and the charges as a share of the goods, before someone else approves
 * it (ADR-008 §7): 2%, Sarthak, 22 Nov. */
export const BILL_TOLERANCE = defineSetting<string>('purchasing.bill_tolerance_pct', percentString(), '2', {
  label: 'Purchase bill tolerance',
  description: 'How far above its purchase order rate a bill’s line may be, in percent, and its charges as a share of its goods, '
    + 'before someone else approves the bill.',
  input: { kind: 'percent' },
});

// Newest first: by date, then the moment each was entered, then id (as purchase orders page).
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const today = (): string => indiaDate(new Date());
const notFound = () => new AppError('not_found', 'There is no such purchase bill');
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This bill is ${status}, so it can’t be ${what}`);
const refuseAt = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

/** The bill within the principal's scope for `key`, by its maker (ADR-008 §13), else not_found; locked when it's to change. */
async function billOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = purchasingTx(ctx).select().from(purchaseBills).where(eq(purchaseBills.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  ctx.see(key, { owner: row.createdBy });
  return row;
}

type PoLine = { id: string; orderId: string; orderNumber: string | null; status: string; partyId: string; itemId: string; rate: string;
  owner: string };
/** The PO lines these goods lines name, by id: only those whose PO the principal may read (purchasing:read, by its
 * maker, ADR-008 §13); one outside that scope is left out, as if there were none. */
async function poLinesOf(ctx: Ctx, ids: readonly string[]): Promise<Map<string, PoLine>> {
  if (ids.length === 0) return new Map();
  const rows = await purchasingTx(ctx).select({ id: purchaseOrderLines.id, orderId: purchaseOrders.id, orderNumber: purchaseOrders.number,
    status: purchaseOrders.status, partyId: purchaseOrders.partyId, itemId: purchaseOrderLines.itemId, rate: purchaseOrderLines.rate,
    owner: purchaseOrders.createdBy })
    .from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(inArray(purchaseOrderLines.id, [...new Set(ids)]));
  return new Map(rows.filter((r) => ctx.can('purchasing:read', { owner: r.owner })).map((r) => [r.id, r]));
}

/** A draft's checks (ADR-008 §4, §7): the dates, the supplier and the GSTIN printed on its bill, each goods line's PO
 * line (placed or closed, the supplier's own), its quantity, and the file. Answers each goods line's PO line. */
async function checkDraft(ctx: Ctx, b: BillIn): Promise<Map<string, PoLine>> {
  if (b.businessDate > today()) throw refuseAt('date_in_future', 'The date is after today', ['businessDate']);
  if (b.supplierInvoiceDate > b.businessDate) {
    throw refuseAt('supplier_date_after_bill', 'The supplier’s date is after the bill’s own', ['supplierInvoiceDate']);
  }
  const supplier = await buyingFrom(ctx, b.supplierId);
  // The GSTIN as printed must be the party's own, or none for an unregistered supplier (ADR-008 §7).
  if ((b.supplierGstin ?? null) !== supplier.gstin) {
    throw refuseAt('gstin_mismatch', supplier.gstin === null ? `${supplier.name} has no GSTIN on record` : `${supplier.name}’s GSTIN is ${supplier.gstin}`,
      ['supplierGstin']);
  }
  const goods = b.lines.flatMap((l, n) => (l.kind === 'goods' ? [{ l, n }] : []));
  const po = await poLinesOf(ctx, goods.map((g) => g.l.poLineId));
  const received = new Map((await receiptLinesFor(ctx, goods.flatMap((g) => (g.l.receiptLineId === null ? [] : [g.l.receiptLineId])),
    { forUpdate: false })).map((r) => [r.id, r]));
  for (const { l, n } of goods) {
    const line = po.get(l.poLineId);
    if (line === undefined) throw refuseAt('unknown_po_line', 'There is no such purchase order line', ['lines', n, 'poLineId']);
    if (line.status !== 'placed' && line.status !== 'closed') {
      throw refuseAt('po_not_placed', `That purchase order is ${line.status}: only a placed one is billed`, ['lines', n, 'poLineId']);
    }
    if (line.partyId !== b.supplierId) throw refuseAt('other_supplier', 'That purchase order is another supplier’s', ['lines', n, 'poLineId']);
    if (l.receiptLineId !== null) {
      // The receipt line it bills, once the goods are in: posted, and for this very PO line (ADR-008 §7).
      const r = received.get(l.receiptLineId);
      if (r === undefined) throw refuseAt('unknown_receipt_line', 'There is no such goods receipt line', ['lines', n, 'receiptLineId']);
      if (r.status !== 'posted') throw refuseAt('receipt_not_posted', `That goods receipt is ${r.status}: only a posted one is billed`,
        ['lines', n, 'receiptLineId']);
      if (r.orderLineId !== l.poLineId) throw refuseAt('not_this_po_line', 'That goods receipt line is for another order line', ['lines', n, 'receiptLineId']);
    }
    await checkQuantity(ctx, line.itemId, l.qty).catch((e: unknown) => {
      throw e instanceof AppError ? refuseAt(e.code, e.message, ['lines', n, 'qty']) : e;
    });
  }
  if (b.fileId !== null) await readyFile(ctx, 'purchase_bill', b.fileId, { wrongKind: ['fileId'] });
  return po;
}

/** Writes a draft's lines afresh, numbered from 1 in the order sent; a goods line takes its PO line's item. */
async function writeLines(ctx: Ctx, billId: string, lines: readonly LineIn[], po: ReadonlyMap<string, PoLine>): Promise<void> {
  const tx = purchasingTx(ctx);
  await tx.delete(purchaseBillLines).where(eq(purchaseBillLines.billId, billId));
  await tx.insert(purchaseBillLines).values(lines.map((l, i) => (l.kind === 'goods'
    ? { billId, lineNo: i + 1, kind: 'goods', poLineId: l.poLineId, receiptLineId: l.receiptLineId, itemId: po.get(l.poLineId)?.itemId ?? '', qty: l.qty,
      rate: l.rate }
    : { billId, lineNo: i + 1, kind: 'charge', charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount })));
}

const header = (b: BillIn) => ({ partyId: b.supplierId, businessDate: b.businessDate, supplierInvoiceNumber: b.supplierInvoiceNumber,
  supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin, statedTotal: b.statedTotal, fileId: b.fileId, notes: b.notes });

/** POST /purchasing/bills (bills:write): a new draft. */
export async function addBill(ctx: Ctx, input: In<typeof createPurchaseBill>): Promise<Out<typeof createPurchaseBill>> {
  const po = await checkDraft(ctx, input);
  const [row] = await purchasingTx(ctx).insert(purchaseBills).values(header(input)).returning({ id: purchaseBills.id });
  if (row === undefined) throw new Error('the purchase bill was not stored');
  await writeLines(ctx, row.id, input.lines, po);
  return { id: row.id };
}

/** PUT /purchasing/bills/:id (bills:write): a draft rewritten whole. */
export async function changeBill(ctx: Ctx, { id, ...input }: In<typeof updatePurchaseBill>): Promise<Out<typeof updatePurchaseBill>> {
  const b = await billOf(ctx, id, 'bills:write', true);
  if (b.status !== 'draft') throw wrongStatus(b.status, 'changed');
  const po = await checkDraft(ctx, input);
  await purchasingTx(ctx).update(purchaseBills).set(header(input)).where(eq(purchaseBills.id, id));
  await writeLines(ctx, id, input.lines, po);
  return {};
}

/** DELETE /purchasing/bills/:id (bills:write): a draft thrown away. */
export async function dropBill(ctx: Ctx, { id }: In<typeof deletePurchaseBill>): Promise<Out<typeof deletePurchaseBill>> {
  const b = await billOf(ctx, id, 'bills:write', true);
  if (b.status !== 'draft') throw wrongStatus(b.status, 'deleted: cancel it instead');
  // shortcut: the bills' approval arrives with posting (RAD-138 PR 3), which closes a pending request here first
  // (withdrawPending), as a purchase order's delete does.
  await purchasingTx(ctx).delete(purchaseBills).where(eq(purchaseBills.id, id));
  return {};
}

/** GET /purchasing/bills (purchasing:read): newest first, a page at a time, the principal's own where that's their scope. */
export async function listBillsPage(ctx: Ctx, input: In<typeof listPurchaseBills>): Promise<Out<typeof listPurchaseBills>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await purchasingTx(ctx).select({ id: purchaseBills.id, number: purchaseBills.number, partyId: purchaseBills.partyId,
    businessDate: purchaseBills.businessDate, status: purchaseBills.status, supplierInvoiceNumber: purchaseBills.supplierInvoiceNumber,
    supplierInvoiceDate: purchaseBills.supplierInvoiceDate, total: purchaseBills.total, createdAt: purchaseBills.createdAt })
    .from(purchaseBills).where(and(
      input.filter.status === undefined ? undefined : eq(purchaseBills.status, input.filter.status),
      input.filter.supplierId === undefined ? undefined : eq(purchaseBills.partyId, input.filter.supplierId),
      listScope(ctx, 'purchasing:read', purchaseBills.createdBy),
      after([purchaseBills.businessDate, purchaseBills.createdAt, purchaseBills.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(purchaseBills.businessDate), desc(purchaseBills.createdAt), desc(purchaseBills.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  // shortcut: one read per distinct supplier on the page, as lib-sales' partyNames; a batched reader joins lib-accounts
  // if pages grow.
  const names = new Map<string, string>();
  for (const id of new Set(page.map((r) => r.partyId))) names.set(id, (await getPartyById(ctx, { id })).name);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, number: r.number, supplierId: r.partyId, supplierName: names.get(r.partyId) ?? '',
      businessDate: r.businessDate, status: r.status as Status, supplierInvoiceNumber: r.supplierInvoiceNumber,
      supplierInvoiceDate: r.supplierInvoiceDate, total: r.total as Money | null,
      // shortcut: no request can wait until posting and its approval arrive (RAD-138 PR 3).
      awaitingApproval: false })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

type Taxed = LineTax & { gstRate: string; gstRateSource: string };
/** The bill's tax from its own lines (RC-056): each at the rate in force on the supplier's invoice date for its item's HSN,
 * or its charge's HSN or SAC; the supplier sells, we buy, so the place of supply is ours (§7, as a PO's). */
async function amountsOf(ctx: Ctx, supplierState: string, on: string, lines: readonly (typeof purchaseBillLines.$inferSelect)[]) {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state to work out the GST');
  const place = placeOfSupply(supplierState, company.stateCode, null);
  const labels = await itemLabels(ctx, lines.flatMap((l) => (l.itemId === null ? [] : [l.itemId])));
  const taxed: Taxed[] = [];
  for (const [n, l] of lines.entries()) {
    const hsn = l.kind === 'goods' ? labels.get(l.itemId ?? '')?.hsn ?? '' : l.hsn ?? '';
    const rate = await gstRateFor(ctx, hsn, on).catch((e: unknown) => {
      throw e instanceof AppError ? refuseAt(e.code, e.message, ['lines', n]) : e;
    });
    const t = l.kind === 'goods' ? lineTax({ qty: l.qty ?? '0', rate: l.rate ?? '0', discountPercent: '0', gstPercent: rate.rate }, place.intraState)
      : lineTax({ qty: '1', rate: l.amount ?? '0', discountPercent: '0', gstPercent: rate.rate }, place.intraState);
    taxed.push({ ...t, gstRate: rate.rate, gstRateSource: rate.source });
  }
  return { placeOfSupply: place.state, lines: taxed, totals: totalsOf(taxed) };
}

/** How far a billed rate is above its PO rate, in percent to two places (0 at or below it); null for a free item's line
 * (a PO rate of 0) billed at a price, which has no percentage and is past any tolerance. */
export function overPoRate(rate: string, poRate: string): string | null {
  if (dec(rate).lte(dec(poRate))) return '0.00';
  if (dec(poRate).isZero()) return null;
  return dec(rate).minus(dec(poRate)).times(100).div(dec(poRate)).toFixed(2);
}

/** GET /purchasing/bills/:id (purchasing:read): with its lines, how each goods line stands against its PO rate, and its
 * amounts, worked out now while a draft, as stored once posted. */
export async function getBillById(ctx: Ctx, { id }: In<typeof getPurchaseBill>): Promise<BillOut> {
  const b = await billOf(ctx, id, 'purchasing:read');
  const lines = await purchasingTx(ctx).select().from(purchaseBillLines).where(eq(purchaseBillLines.billId, id)).orderBy(asc(purchaseBillLines.lineNo));
  const supplier = await getPartyById(ctx, { id: b.partyId });
  const po = await poLinesOf(ctx, lines.flatMap((l) => (l.poLineId === null ? [] : [l.poLineId])));
  const labels = await itemLabels(ctx, lines.flatMap((l) => (l.itemId === null ? [] : [l.itemId])));
  const tolerance = dec(ctx.settings.get(BILL_TOLERANCE));
  const none = { cgst: null, sgst: null, igst: null };
  let amounts: BillOut['amounts'];
  let lineAmounts: LineAmounts[];
  if (b.status === 'draft') {
    const worked = await amountsOf(ctx, supplier.stateCode, b.supplierInvoiceDate, lines).catch((e: unknown) => {
      if (e instanceof AppError && (e.code === 'company_profile_incomplete' || e.code === 'no_gst_rate')) return e;
      throw e;
    });
    if (worked instanceof AppError) {
      const taxable = lines.map((l) => (l.kind === 'goods' ? roundMoney(dec(l.qty ?? '0').times(dec(l.rate ?? '0'))) : roundMoney(l.amount ?? '0')));
      amounts = { placeOfSupply: null, taxable: roundMoney(taxable.reduce((s, t) => s.plus(dec(t)), dec('0'))), ...none, roundOff: null, total: null,
        note: worked.code === 'company_profile_incomplete' ? 'Set the company’s state to work out the GST' : worked.message };
      lineAmounts = taxable.map((t) => ({ gstRate: null, gstRateSource: null, taxable: t, ...none, lineTotal: null }));
    } else {
      const t = worked.totals;
      amounts = { placeOfSupply: worked.placeOfSupply, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff,
        total: t.total, note: null };
      lineAmounts = worked.lines.map((l) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst,
        igst: l.igst, lineTotal: l.lineTotal }));
    }
  } else {
    amounts = { placeOfSupply: b.placeOfSupply, taxable: b.taxable ?? '0.00', cgst: b.cgst, sgst: b.sgst, igst: b.igst, roundOff: b.roundOff,
      total: b.total, note: null };
    lineAmounts = lines.map((l) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable ?? '0.00', cgst: l.cgst, sgst: l.sgst,
      igst: l.igst, lineTotal: l.lineTotal }));
  }
  // The charges as a share of the goods' taxable value: past the tolerance, the bill needs approval (ADR-008 §7).
  const goodsValue = lines.reduce((s, l, i) => (l.kind === 'goods' ? s.plus(dec(lineAmounts[i]?.taxable ?? '0')) : s), dec('0'));
  const charges = lines.reduce((s, l, i) => (l.kind === 'charge' ? s.plus(dec(lineAmounts[i]?.taxable ?? '0')) : s), dec('0'));
  const chargesOverTolerance = !charges.isZero() && (goodsValue.isZero() || charges.times(100).div(goodsValue).gt(tolerance));
  const empty = { gstRate: null, gstRateSource: null, taxable: '0.00', ...none, lineTotal: null };
  return {
    id: b.id, number: b.number, supplierId: b.partyId, supplierName: supplier.name, businessDate: b.businessDate, status: b.status as Status,
    supplierInvoiceNumber: b.supplierInvoiceNumber, supplierInvoiceDate: b.supplierInvoiceDate, total: b.total as Money | null,
    awaitingApproval: false, supplierGstin: b.supplierGstin, statedTotal: b.statedTotal as Money, fileId: b.fileId, notes: b.notes, amounts,
    chargesOverTolerance, cancelReason: b.cancelReason,
    lines: lines.map((l, i) => {
      const a = lineAmounts[i] ?? empty;
      if (l.kind === 'charge') {
        return { kind: 'charge' as const, id: l.id, lineNo: l.lineNo, charge: l.charge as 'freight', description: l.description ?? '', hsn: l.hsn ?? '',
          amount: l.amount as Money, amounts: a };
      }
      const p = po.get(l.poLineId ?? '');
      const over = overPoRate(l.rate ?? '0', p?.rate ?? '0');
      const item = labels.get(l.itemId ?? '');
      return { kind: 'goods' as const, id: l.id, lineNo: l.lineNo, poLineId: l.poLineId ?? '', receiptLineId: l.receiptLineId, itemId: l.itemId ?? '',
        sku: item?.sku ?? '', name: item?.name ?? '', unit: item?.unit ?? '', qty: l.qty ?? '0', rate: l.rate ?? '0', poRate: p?.rate ?? '0',
        poNumber: p?.orderNumber ?? '', overPoRate: over, overTolerance: over === null || dec(over).gt(tolerance), amounts: a };
    }),
  };
}

/** What posted bills not cancelled have billed of these receipt lines, by line (RAD-138): a receipt any of it was billed
 * on can't be cancelled (receipt_in_use, ADR-008 §6), and a bill bills at most what's left (over_received). */
export async function billedQty(ctx: Ctx, receiptLineIds: readonly string[]): Promise<Map<string, Decimal>> {
  const got = new Map(receiptLineIds.map((id) => [id, dec('0')]));
  if (receiptLineIds.length === 0) return got;
  const rows = await purchasingTx(ctx).select({ id: purchaseBillLines.receiptLineId, qty: sum(purchaseBillLines.qty) }).from(purchaseBillLines)
    .innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId))
    .where(and(inArray(purchaseBillLines.receiptLineId, [...new Set(receiptLineIds)]), eq(purchaseBills.status, 'posted')))
    .groupBy(purchaseBillLines.receiptLineId);
  for (const r of rows) if (r.id !== null) got.set(r.id, dec(r.qty ?? '0'));
  return got;
}
