// Purchase bills (M4-03, RAD-138; ADR-008 §4, §7, §7a): a supplier's own invoice entered as a draft, with its file,
// the supplier's number, date and GSTIN as printed, its goods lines (each a PO line) and its charges. The duplicate
// check is the database's unique index, over every bill not cancelled. A draft's tax is worked out on read, from its own
// lines at the rates in force on the supplier's invoice date (RC-056), and how each line stands against its PO rate.
// Posting, the three-way match against receipts and the approval join with M4-02's goods receipts (RAD-138 PR 3).
import { after, purchaseBillLines, purchaseBills, purchasingTx } from '@radcore/db/purchasing';
import { vDocumentPaid } from '@radcore/db/views';
import { getPartyById, paidOf } from '@radcore/lib-accounts';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import { AppError, awaitingApproval, decodeCursor, encodeCursor, listScope, withdrawPending, type Ctx } from '@radcore/lib-platform';
import { itemLabels, jobWorkLinesFor } from '@radcore/lib-stock';
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { createPurchaseBill, deletePurchaseBill, getPurchaseBill, listPurchaseBills, updatePurchaseBill } from '../contract.ts';
import {
  amountsOf, BILL_TOLERANCE, billOf, checkDraft, holdJobWork, holdOrders, jobWorkLineIdsOf, overPoRate, PAGE_KEY, poLineIdsOf, poLinesOf, wrongStatus,
  type BillIn, type BillOut, type In, type LineAmounts, type LineIn, type Out, type Status,
} from './bill-checks.ts';
import { billApproval } from './bill-post.ts';

/** Writes a draft's lines afresh, numbered from 1 in the order sent; a goods line takes its PO line's item, a job
 * worker's charge its receipt line's made item. */
async function writeLines(ctx: Ctx, billId: string, lines: readonly LineIn[], { po, made }: Checked): Promise<void> {
  const tx = purchasingTx(ctx);
  await tx.delete(purchaseBillLines).where(eq(purchaseBillLines.billId, billId));
  await tx.insert(purchaseBillLines).values(lines.map((l, i) => {
    const at = { billId, lineNo: i + 1, kind: l.kind };
    if (l.kind === 'goods') {
      return { ...at, poLineId: l.poLineId, receiptLineId: l.receiptLineId, itemId: po.get(l.poLineId)?.itemId ?? '', qty: l.qty, rate: l.rate };
    }
    if (l.kind === 'job_work') {
      return { ...at, jobWorkReceiptLineId: l.jobWorkReceiptLineId, itemId: made.get(l.jobWorkReceiptLineId)?.madeItemId ?? '', qty: l.qty,
        rate: l.rate, hsn: l.hsn };
    }
    return { ...at, charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount, expenseCategoryId: l.expenseCategoryId ?? null,
      expenseAccountId: l.expenseAccountId ?? null };
  }));
}
type Checked = Awaited<ReturnType<typeof checkDraft>>;

const header = (b: BillIn) => ({ partyId: b.supplierId, businessDate: b.businessDate, supplierInvoiceNumber: b.supplierInvoiceNumber,
  supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin, statedTotal: b.statedTotal, fileId: b.fileId, notes: b.notes });

/** POST /purchasing/bills (bills:write): a new draft. */
export async function addBill(ctx: Ctx, input: In<typeof createPurchaseBill>): Promise<Out<typeof createPurchaseBill>> {
  await holdOrders(ctx, poLineIdsOf(input.lines));
  await holdJobWork(ctx, jobWorkLineIdsOf(input.lines));
  const checked = await checkDraft(ctx, input);
  const [row] = await purchasingTx(ctx).insert(purchaseBills).values(header(input)).returning({ id: purchaseBills.id });
  if (row === undefined) throw new Error('the purchase bill was not stored');
  await writeLines(ctx, row.id, input.lines, checked);
  return { id: row.id };
}

/** PUT /purchasing/bills/:id (bills:write): a draft rewritten whole. */
export async function changeBill(ctx: Ctx, { id, ...input }: In<typeof updatePurchaseBill>): Promise<Out<typeof updatePurchaseBill>> {
  // §12: the draft read unlocked to learn the POs it names now, then those and the new ones locked, then the bill.
  const seen = await billOf(ctx, id, 'bills:write');
  if (seen.status !== 'draft') throw wrongStatus(seen.status, 'changed');
  const named = await purchasingTx(ctx).select({ id: purchaseBillLines.poLineId, jobWork: purchaseBillLines.jobWorkReceiptLineId })
    .from(purchaseBillLines).where(eq(purchaseBillLines.billId, id));
  await holdOrders(ctx, [...named.flatMap((l) => (l.id === null ? [] : [l.id])), ...poLineIdsOf(input.lines)]);
  await holdJobWork(ctx, [...named.flatMap((l) => (l.jobWork === null ? [] : [l.jobWork])), ...jobWorkLineIdsOf(input.lines)]);
  const b = await billOf(ctx, id, 'bills:write', true);
  if (b.status !== 'draft') throw wrongStatus(b.status, 'changed');
  const checked = await checkDraft(ctx, input);
  await purchasingTx(ctx).update(purchaseBills).set(header(input)).where(eq(purchaseBills.id, id));
  await writeLines(ctx, id, input.lines, checked);
  return {};
}

/** DELETE /purchasing/bills/:id (bills:write): a draft thrown away. */
export async function dropBill(ctx: Ctx, { id }: In<typeof deletePurchaseBill>): Promise<Out<typeof deletePurchaseBill>> {
  const b = await billOf(ctx, id, 'bills:write', true);
  if (b.status !== 'draft') throw wrongStatus(b.status, 'deleted: cancel it instead');
  // A pending request goes with it, superseded, as a purchase order's does (the architect on RAD-114).
  await withdrawPending(ctx, billApproval, id);
  await purchasingTx(ctx).delete(purchaseBills).where(eq(purchaseBills.id, id));
  return {};
}

/** A posted bill's total less what's been paid on it; null while a draft or once cancelled. */
const openOf = (status: string, total: string | null, paid: string | null): Money | null =>
  (status !== 'posted' || total === null ? null : roundMoney(dec(total).minus(dec(paid ?? '0'))));

/** GET /purchasing/bills (purchasing:read): newest first, a page at a time, the principal's own where that's their scope. */
export async function listBillsPage(ctx: Ctx, input: In<typeof listPurchaseBills>): Promise<Out<typeof listPurchaseBills>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await purchasingTx(ctx).select({ id: purchaseBills.id, number: purchaseBills.number, partyId: purchaseBills.partyId,
    businessDate: purchaseBills.businessDate, status: purchaseBills.status, supplierInvoiceNumber: purchaseBills.supplierInvoiceNumber,
    supplierInvoiceDate: purchaseBills.supplierInvoiceDate, total: purchaseBills.total, owed: purchaseBills.owed, createdAt: purchaseBills.createdAt,
    paid: vDocumentPaid.paid })
    // What's been paid on each, from lib-accounts' allocations through their view (ADR-001 §2, the architect on RAD-143).
    .from(purchaseBills).leftJoin(vDocumentPaid, and(eq(vDocumentPaid.documentTable, 'purchase_bills'), eq(vDocumentPaid.documentId, purchaseBills.id)))
    .where(and(
      input.filter.status === undefined ? undefined : eq(purchaseBills.status, input.filter.status),
      // Posted, with its total above what's been paid on it: the bills a payment out can still be applied to.
      // What's owed is the invoice less its TDS (the architect on RAD-158), as allocations read it.
      input.filter.open === true ? and(eq(purchaseBills.status, 'posted'), or(and(isNull(vDocumentPaid.paid), gt(purchaseBills.owed, '0')),
        gt(purchaseBills.owed, vDocumentPaid.paid))) : undefined,
      input.filter.supplierId === undefined ? undefined : eq(purchaseBills.partyId, input.filter.supplierId),
      listScope(ctx, 'purchasing:read', purchaseBills.createdBy),
      after([purchaseBills.businessDate, purchaseBills.createdAt, purchaseBills.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(purchaseBills.businessDate), desc(purchaseBills.createdAt), desc(purchaseBills.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  // shortcut: one read per distinct supplier on the page, as lib-sales' partyNames; a batched reader joins lib-accounts
  // if pages grow.
  const names = new Map<string, string>();
  for (const id of new Set(page.map((r) => r.partyId))) names.set(id, (await getPartyById(ctx, { id })).name);
  const waiting = await awaitingApproval(ctx, billApproval, page.map((r) => r.id));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, number: r.number, supplierId: r.partyId, supplierName: names.get(r.partyId) ?? '',
      businessDate: r.businessDate, status: r.status as Status, supplierInvoiceNumber: r.supplierInvoiceNumber,
      supplierInvoiceDate: r.supplierInvoiceDate, total: r.total as Money | null,
      awaitingApproval: waiting.has(r.id), open: openOf(r.status, r.owed, r.paid) })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /purchasing/bills/:id (purchasing:read): with its lines, how each goods line stands against its PO rate, and its
 * amounts, worked out now while a draft, as stored once posted. */
export async function getBillById(ctx: Ctx, { id }: In<typeof getPurchaseBill>): Promise<BillOut> {
  const b = await billOf(ctx, id, 'purchasing:read');
  const lines = await purchasingTx(ctx).select().from(purchaseBillLines).where(eq(purchaseBillLines.billId, id)).orderBy(asc(purchaseBillLines.lineNo));
  const supplier = await getPartyById(ctx, { id: b.partyId });
  const po = await poLinesOf(ctx, lines.flatMap((l) => (l.poLineId === null ? [] : [l.poLineId])));
  const labels = await itemLabels(ctx, lines.flatMap((l) => (l.itemId === null ? [] : [l.itemId])));
  const made = new Map((await jobWorkLinesFor(ctx, lines.flatMap((l) => (l.jobWorkReceiptLineId === null ? [] : [l.jobWorkReceiptLineId])),
    { lock: false })).map((r) => [r.id, r]));
  const tolerance = dec(ctx.settings.get(BILL_TOLERANCE));
  const none = { cgst: null, sgst: null, igst: null };
  let amounts: BillOut['amounts'];
  let lineAmounts: LineAmounts[];
  if (b.status === 'draft') {
    const worked = await amountsOf(ctx, supplier, b.supplierInvoiceDate, lines).catch((e: unknown) => {
      if (e instanceof AppError && (e.code === 'company_profile_incomplete' || e.code === 'no_gst_rate')) return e;
      throw e;
    });
    if (worked instanceof AppError) {
      const taxable = lines.map((l) => (l.kind !== 'charge' ? roundMoney(dec(l.qty ?? '0').times(dec(l.rate ?? '0'))) : roundMoney(l.amount ?? '0')));
      amounts = { placeOfSupply: null, taxable: roundMoney(taxable.reduce((s, t) => s.plus(dec(t)), dec('0'))), ...none, roundOff: null, total: null,
        note: worked.code === 'company_profile_incomplete' ? 'Set the company’s state to work out the GST' : worked.message };
      lineAmounts = taxable.map((t) => ({ gstRate: null, gstRateSource: null, taxable: t, ...none, lineTotal: null, reverseCharge: null }));
    } else {
      const t = worked.totals;
      amounts = { placeOfSupply: worked.placeOfSupply, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff,
        total: t.total, note: null };
      lineAmounts = worked.lines.map((l) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst,
        igst: l.igst, lineTotal: l.lineTotal, reverseCharge: l.reverseCharge }));
    }
  } else {
    amounts = { placeOfSupply: b.placeOfSupply, taxable: b.taxable ?? '0.00', cgst: b.cgst, sgst: b.sgst, igst: b.igst, roundOff: b.roundOff,
      total: b.total, note: null };
    lineAmounts = lines.map((l) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable ?? '0.00', cgst: l.cgst, sgst: l.sgst,
      igst: l.igst, lineTotal: l.lineTotal,
      reverseCharge: l.rcmCgst === null ? null : { cgst: l.rcmCgst, sgst: l.rcmSgst ?? '0.00', igst: l.rcmIgst ?? '0.00' } }));
  }
  // The charges as a share of the goods' taxable value: past the tolerance, the bill needs approval (ADR-008 §7).
  const goodsValue = lines.reduce((s, l, i) => (l.kind !== 'charge' ? s.plus(dec(lineAmounts[i]?.taxable ?? '0')) : s), dec('0'));
  const charges = lines.reduce((s, l, i) => (l.kind === 'charge' ? s.plus(dec(lineAmounts[i]?.taxable ?? '0')) : s), dec('0'));
  // A bill of charges only has no goods to share them (RAD-152), so it's never past this.
  const chargesOverTolerance = !lines.every((l) => l.kind === 'charge') && !charges.isZero()
    && (goodsValue.isZero() || charges.times(100).div(goodsValue).gt(tolerance));
  const empty = { gstRate: null, gstRateSource: null, taxable: '0.00', ...none, lineTotal: null, reverseCharge: null };
  return {
    id: b.id, number: b.number, supplierId: b.partyId, supplierName: supplier.name, businessDate: b.businessDate, status: b.status as Status,
    supplierInvoiceNumber: b.supplierInvoiceNumber, supplierInvoiceDate: b.supplierInvoiceDate, total: b.total as Money | null,
    awaitingApproval: (await awaitingApproval(ctx, billApproval, [id])).has(id),
    open: openOf(b.status, b.owed, (await paidOf(ctx, 'purchase_bills', [id])).get(id)?.paid ?? null), supplierGstin: b.supplierGstin, statedTotal: b.statedTotal as Money, fileId: b.fileId, notes: b.notes, amounts,
    chargesOverTolerance, cancelReason: b.cancelReason,
    lines: lines.map((l, i) => {
      const a = lineAmounts[i] ?? empty;
      if (l.kind === 'charge') {
        return { kind: 'charge' as const, id: l.id, lineNo: l.lineNo, charge: l.charge as 'freight', description: l.description ?? '', hsn: l.hsn ?? '',
          amount: l.amount as Money, expenseCategoryId: l.expenseCategoryId, expenseAccountId: l.expenseAccountId, amounts: a };
      }
      const item = labels.get(l.itemId ?? '');
      if (l.kind === 'job_work') {
        // Unseen where the reader can't see the receipt (the auditor on #408): null, never a made-up 0.
        const r = made.get(l.jobWorkReceiptLineId ?? '');
        const over = r === undefined ? null : overPoRate(l.rate ?? '0', r.chargeRate ?? '0');
        return { kind: 'job_work' as const, id: l.id, lineNo: l.lineNo, jobWorkReceiptLineId: l.jobWorkReceiptLineId ?? '', itemId: l.itemId ?? '',
          sku: item?.sku ?? '', name: item?.name ?? '', unit: item?.unit ?? '', qty: l.qty ?? '0', rate: l.rate ?? '0', hsn: l.hsn ?? '',
          chargeRate: r?.chargeRate ?? null, receiptNumber: r?.receiptNumber ?? null, overChargeRate: over,
          overTolerance: r === undefined ? null : over === null || dec(over).gt(tolerance), amounts: a };
      }
      const p = po.get(l.poLineId ?? '');
      const over = overPoRate(l.rate ?? '0', p?.rate ?? '0');
      return { kind: 'goods' as const, id: l.id, lineNo: l.lineNo, poLineId: l.poLineId ?? '', receiptLineId: l.receiptLineId, itemId: l.itemId ?? '',
        sku: item?.sku ?? '', name: item?.name ?? '', unit: item?.unit ?? '', qty: l.qty ?? '0', rate: l.rate ?? '0', poRate: p?.rate ?? '0',
        poNumber: p?.orderNumber ?? '', overPoRate: over, overTolerance: over === null || dec(over).gt(tolerance), amounts: a };
    }),
  };
}
