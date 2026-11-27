// What purchase bills' drafts and posting share (M4-03, RAD-138; ADR-008 §4, §7, §12): the bill and its PO lines within
// the principal's scope, a draft's checks (dates, supplier and GSTIN, PO and receipt lines, file), the POs' locks, and
// the tax worked out from the bill's own lines at the supplier's invoice date (RC-056).
import { purchaseBillLines, purchaseBills, purchaseOrderLines, purchaseOrders, purchasingTx } from '@radcore/db/purchasing';
import { categoryPairs, defaultTdsSection, getCompanyProfile } from '@radcore/lib-accounts';
import { dec, indiaDate, percentString, roundMoney, type Money } from '@radcore/lib-common';
import { gstRateFor, isReverseCharge, lineTax, placeOfSupply, rcmRulesOn, totalsOf, type LineTax, type RcmParty } from '@radcore/lib-gst';
import { AppError, defineSeries, defineSetting, listScope, momentKey, readyFile, type Ctx } from '@radcore/lib-platform';
import { checkQuantity, itemLabels, jobWorkLinesFor } from '@radcore/lib-stock';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { createPurchaseBill, getPurchaseBill } from '../contract.ts';
import { receiptLinesFor } from './receipt-lines.ts';
import { buyingFrom, servicesOnly } from './suppliers.ts';

export type In<C extends { input: z.ZodType }> = z.output<C['input']>;
export type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
export type Status = 'draft' | 'posted' | 'cancelled';
export type BillIn = In<typeof createPurchaseBill>;
export type LineIn = BillIn['lines'][number];
export type Row = typeof purchaseBills.$inferSelect;
export type BillOut = Out<typeof getPurchaseBill>;
export type LineAmounts = BillOut['lines'][number]['amounts'];

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
export const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const today = (): string => indiaDate(new Date());
const notFound = () => new AppError('not_found', 'There is no such purchase bill');
export const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This bill is ${status}, so it can’t be ${what}`);
const refuseAt = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

/** The bill within the principal's scope for `key`, by its maker (ADR-008 §13), else not_found; locked when it's to change. */
export async function billOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = purchasingTx(ctx).select().from(purchaseBills).where(eq(purchaseBills.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  ctx.see(key, { owner: row.createdBy });
  return row;
}

export type PoLine = { id: string; orderId: string; orderNumber: string | null; status: string; partyId: string; itemId: string; rate: string;
  owner: string };
/** The PO lines these goods lines name, by id: only those whose PO the principal may read (purchasing:read, by its
 * maker, ADR-008 §13); one outside that scope is left out, as if there were none. */
export async function poLinesOf(ctx: Ctx, ids: readonly string[]): Promise<Map<string, PoLine>> {
  if (ids.length === 0) return new Map();
  const rows = await purchasingTx(ctx).select({ id: purchaseOrderLines.id, orderId: purchaseOrders.id, orderNumber: purchaseOrders.number,
    status: purchaseOrders.status, partyId: purchaseOrders.partyId, itemId: purchaseOrderLines.itemId, rate: purchaseOrderLines.rate,
    owner: purchaseOrders.createdBy })
    .from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(inArray(purchaseOrderLines.id, [...new Set(ids)]));
  return new Map(rows.filter((r) => ctx.can('purchasing:read', { owner: r.owner })).map((r) => [r.id, r]));
}

export type JobWorkLine = Awaited<ReturnType<typeof jobWorkLinesFor>>[number];
/** A draft's checks (ADR-008 §4, §7): the dates, the supplier and the GSTIN printed on its bill, each goods line's PO
 * line (placed or closed, the supplier's own), each job worker's charge's receipt line (posted, the job worker's own, with
 * goods made), their quantities, and the file. Answers each goods line's PO line and each charge's job-work line. */
export async function checkDraft(ctx: Ctx, b: BillIn): Promise<{ po: Map<string, PoLine>; made: Map<string, JobWorkLine>; blocked: boolean[]; sections: (string | null)[] }> {
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
  // An overseas supplier bills services only: charges, never goods or a job worker's charge on goods (ADR-010 §4).
  if (supplier.overseas && b.lines.some((l) => l.kind !== 'charge')) throw servicesOnly(supplier.name);
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
  const jobWork = b.lines.flatMap((l, n) => (l.kind === 'job_work' ? [{ l, n }] : []));
  const made = new Map((await jobWorkLinesFor(ctx, jobWork.map((x) => x.l.jobWorkReceiptLineId), { lock: false })).map((r) => [r.id, r]));
  for (const { l, n } of jobWork) {
    const at = ['lines', n, 'jobWorkReceiptLineId'];
    const r = made.get(l.jobWorkReceiptLineId);
    // Only a line that made goods has a charge to bill (ADR-008 §11).
    if (r?.madeItemId == null) throw refuseAt('unknown_receipt_line', 'There is no such job-work receipt line with goods made', at);
    if (r.status !== 'posted') throw refuseAt('receipt_not_posted', `That job-work receipt is ${r.status}: only a posted one is billed`, at);
    if (r.partyId !== b.supplierId) throw refuseAt('other_supplier', 'That job work was another job worker’s', at);
    await checkQuantity(ctx, r.madeItemId, l.qty).catch((e: unknown) => {
      throw e instanceof AppError ? refuseAt(e.code, e.message, ['lines', n, 'qty']) : e;
    });
  }
  if (b.fileId !== null) await readyFile(ctx, 'purchase_bill', b.fileId, { wrongKind: ['fileId'] });
  const { blocked, categoryTds } = await chargeCategories(ctx, b.lines);
  // A service line's TDS section (ADR-009 §4): its own (null for none), else the supplier's default, else its category's.
  const partyDefault = await defaultTdsSection(ctx, b.supplierId);
  const sections = b.lines.map((l, n) => (l.kind === 'goods' ? null
    : l.tdsSectionId !== undefined ? l.tdsSectionId : partyDefault ?? categoryTds[n] ?? null));
  return { po, made, blocked, sections };
}

/** Each line's category rule (ADR-009 §2, RAD-152): a charge naming its expense category and one of that category's
 * switched-on accounts, both or neither; true where the category's credit is blocked. */
async function chargeCategories(ctx: Ctx, lines: readonly LineIn[]): Promise<{ blocked: boolean[]; categoryTds: (string | null)[] }> {
  const named = lines.flatMap((l, n) => (l.kind === 'charge' && (l.expenseCategoryId != null || l.expenseAccountId != null) ? [{ l, n }] : []));
  const pairs = await categoryPairs(ctx, named.flatMap(({ l }) => (l.kind === 'charge' && l.expenseCategoryId != null && l.expenseAccountId != null
    ? [{ categoryId: l.expenseCategoryId, accountId: l.expenseAccountId }] : [])));
  const blocked = lines.map(() => false);
  const categoryTds: (string | null)[] = lines.map(() => null);
  for (const { l, n } of named) {
    if (l.kind !== 'charge') continue;
    const pair = pairs.get(`${l.expenseCategoryId ?? ''}:${l.expenseAccountId ?? ''}`);
    if (pair === undefined) throw refuseAt('not_in_category', 'Name an expense category and one of the accounts it posts to', ['lines', n, 'expenseAccountId']);
    if (!pair.active) throw refuseAt('category_inactive', 'That expense category or account is switched off', ['lines', n, 'expenseCategoryId']);
    blocked[n] = pair.blocked;
    categoryTds[n] = pair.defaultTds;
  }
  return { blocked, categoryTds };
}

export const poLineIdsOf = (lines: readonly LineIn[]): string[] => lines.flatMap((l) => (l.kind === 'goods' ? [l.poLineId] : []));
export const jobWorkLineIdsOf = (lines: readonly LineIn[]): string[] => lines.flatMap((l) => (l.kind === 'job_work' ? [l.jobWorkReceiptLineId] : []));

/** The job-work receipts these lines name, FOR SHARE in id order, after the POs and before the bill (ADR-008 §12): a
 * receipt's cancel holds its row FOR UPDATE while charges_billed reads which bills name it, so a draft naming its lines
 * waits for it, and it for the draft (backend-2 on #408, as #370's POs). */
export async function holdJobWork(ctx: Ctx, jobWorkLineIds: readonly string[]): Promise<void> {
  await jobWorkLinesFor(ctx, jobWorkLineIds, { lock: 'share' });
}

/** The POs these PO lines are on, locked FOR SHARE in id order, before the bill (ADR-008 §12: POs, then receipts, then
 * bills). A placed PO's change holds its row FOR UPDATE while it checks which lines bills name (po_billed), so a draft
 * naming its lines waits for it, and it for the draft: never both. Only POs the principal may read are taken. */
export async function holdOrders(ctx: Ctx, poLineIds: readonly string[]): Promise<void> {
  if (poLineIds.length === 0) return;
  const tx = purchasingTx(ctx);
  const ids = [...new Set((await tx.select({ id: purchaseOrderLines.orderId }).from(purchaseOrderLines)
    .where(inArray(purchaseOrderLines.id, [...new Set(poLineIds)]))).map((o) => o.id))];
  if (ids.length === 0) return;
  await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(inArray(purchaseOrders.id, ids),
    listScope(ctx, 'purchasing:read', purchaseOrders.createdBy))).orderBy(asc(purchaseOrders.id)).for('share');
}


type Heads = { cgst: Money; sgst: Money; igst: Money };
type Taxed = LineTax & { gstRate: string; gstRateSource: string; reverseCharge: Heads | null };
/** The bill's tax from its own lines (RC-056): each at the rate in force on the supplier's invoice date for its item's HSN,
 * or its charge's HSN or SAC; the supplier sells, we buy, so the place of supply is ours (§7, as a PO's). A charge under
 * reverse charge on that date (ADR-010 §4) carries no tax of the supplier's: its tax is ours, by the same heads, and an
 * overseas supplier's (state 96) is always IGST. */
export async function amountsOf(ctx: Ctx, supplier: RcmParty & { stateCode: string }, on: string, lines: readonly (typeof purchaseBillLines.$inferSelect)[]) {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state to work out the GST');
  const place = placeOfSupply(supplier.stateCode, company.stateCode, null);
  const rules = lines.some((l) => l.kind === 'charge') ? await rcmRulesOn(ctx, on) : [];
  const labels = await itemLabels(ctx, lines.flatMap((l) => (l.itemId === null ? [] : [l.itemId])));
  const taxed: Taxed[] = [];
  for (const [n, l] of lines.entries()) {
    // A job worker's charge is a service, taxed at its own SAC, not its made item's HSN.
    const hsn = l.kind === 'goods' ? labels.get(l.itemId ?? '')?.hsn ?? '' : l.hsn ?? '';
    const rate = await gstRateFor(ctx, hsn, on).catch((e: unknown) => {
      throw e instanceof AppError ? refuseAt(e.code, e.message, ['lines', n]) : e;
    });
    const t = l.kind === 'charge' ? lineTax({ qty: '1', rate: l.amount ?? '0', discountPercent: '0', gstPercent: rate.rate }, place.intraState)
      : lineTax({ qty: l.qty ?? '0', rate: l.rate ?? '0', discountPercent: '0', gstPercent: rate.rate }, place.intraState);
    if (l.kind === 'charge' && isReverseCharge(hsn, supplier, on, rules)) {
      const nil = roundMoney('0');
      taxed.push({ taxable: t.taxable, cgst: nil, sgst: nil, igst: nil, lineTotal: t.taxable, gstRate: rate.rate, gstRateSource: rate.source,
        reverseCharge: { cgst: t.cgst, sgst: t.sgst, igst: t.igst } });
    } else {
      taxed.push({ ...t, gstRate: rate.rate, gstRateSource: rate.source, reverseCharge: null });
    }
  }
  return { placeOfSupply: place.state, intraState: place.intraState, lines: taxed, totals: totalsOf(taxed) };
}

/** The bill's stated total against the worked-out one, within a rupee: total_mismatch, or rcm_bill_has_tax when the
 * supplier charged the tax we owe under reverse charge (ADR-010 §4), which its bill then states and ours doesn't. */
export function checkStated(a: Awaited<ReturnType<typeof amountsOf>>, stated: string): void {
  const off = (more: Money | '0') => dec(a.totals.total).plus(dec(more)).minus(dec(stated)).abs().gte(1);
  if (!off('0')) return;
  const ours = roundMoney(a.lines.reduce((s, l) => (l.reverseCharge === null ? s
    : s.plus(dec(l.reverseCharge.cgst)).plus(dec(l.reverseCharge.sgst)).plus(dec(l.reverseCharge.igst))), dec('0')));
  if (!dec(ours).isZero() && !off(ours)) {
    throw refuseAt('rcm_bill_has_tax', 'The supplier’s bill charges GST on a reverse-charge service: that tax is ours to pay, so ask for a bill without it',
      ['statedTotal']);
  }
  throw refuseAt('total_mismatch', `The bill works out at ${a.totals.total}, not the ${stated} it states: put it right with the supplier`, ['statedTotal']);
}

/** How far a billed rate is above its PO rate, in percent to two places (0 at or below it); null for a free item's line
 * (a PO rate of 0) billed at a price, which has no percentage and is past any tolerance. */
export function overPoRate(rate: string, poRate: string): string | null {
  if (dec(rate).lte(dec(poRate))) return '0.00';
  if (dec(poRate).isZero()) return null;
  return dec(rate).minus(dec(poRate)).times(100).div(dec(poRate)).toFixed(2);
}

/** The stored draft as its save sent it, for the draft's checks again. */
export const inputOf = (b: Row, lines: readonly (typeof purchaseBillLines.$inferSelect)[]): BillIn => ({ supplierId: b.partyId, businessDate: b.businessDate,
  supplierInvoiceNumber: b.supplierInvoiceNumber, supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin,
  statedTotal: b.statedTotal as Money, fileId: b.fileId, notes: b.notes,
  lines: lines.map((l) => (l.kind === 'goods'
    ? { kind: 'goods' as const, poLineId: l.poLineId ?? '', receiptLineId: l.receiptLineId, qty: (l.qty ?? '0') as never, rate: (l.rate ?? '0') as never }
    : l.kind === 'job_work'
      ? { kind: 'job_work' as const, jobWorkReceiptLineId: l.jobWorkReceiptLineId ?? '', qty: (l.qty ?? '0') as never, rate: (l.rate ?? '0') as never,
        hsn: l.hsn ?? '', tdsSectionId: l.tdsSectionId }
      : { kind: 'charge' as const, charge: (l.charge ?? 'other') as 'other', description: l.description ?? '', hsn: l.hsn ?? '', amount: (l.amount ?? '0') as Money,
        expenseCategoryId: l.expenseCategoryId, expenseAccountId: l.expenseAccountId, tdsSectionId: l.tdsSectionId })) });
