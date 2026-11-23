// A supplier return's billed part, its debit note (M4-05, RAD-140; ADR-008 §3, §7, §8, §12; ADR-006 §6, F4's billed
// variant; the architect on RAD-140). Each return line is split by what was billed: what's still unbilled of its receipt
// line first (back against Goods Received Not Billed), then what bills billed, against those bills latest first, each at
// that bill line's rate and GST rate. The billed parts are the debit note: numbered DBN, registered as a payable credit
// (ADR-005 §7a) and applied to the bills it debits while they have anything open; what's left stays with the supplier.
import { purchaseBillLines, purchaseBills, purchasingTx, supplierReturnDebits } from '@radcore/db/purchasing';
import { applyCredit, claimedInputGst, creditApplicationsOf, getCompanyProfile, paidOf, reverseCreditApplication } from '@radcore/lib-accounts';
import { dec, roundMoney, type Decimal, type Money } from '@radcore/lib-common';
import { lineTax, totalsOf, type LineTax } from '@radcore/lib-gst';
import { AppError, defineSeries, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { billedQty } from './billed.ts';
import { debitedOf, unbilledReturnedOf } from './received.ts';

/** Debit notes' numbers (ADR-008 §3): DBN/YY-YY/NNNNN, drawn as a return with a billed part posts. */
export const DEBIT_NOTE_SERIES = defineSeries('purchasing.debit_note', 'DBN', { digits: 5, label: 'Debit notes' });

const SOURCE = 'supplier_returns';
const zero = () => dec('0');
const minOf = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);

type BillPart = { billId: string; billNumber: string; billDate: string; billLineId: string; receiptLineId: string; qty: Decimal; rate: string;
  gstRate: string | null; placeOfSupply: string; claimable: boolean; total: string };

/**
 * The posted bills' goods lines that billed these receipt lines, latest first (by bill date, then number, drawn in
 * posting order; §7 bills a line's accepted goods first, so its rejects sit on the later bills). Each bill must be in the
 * principal's purchasing:read
 * scope (not_found otherwise, as for any record they can't see). Locked, in id order, when `forUpdate`: after the
 * return itself (§12: returns before bills, the credit before its charge).
 */
async function billPartsOf(ctx: Ctx, receiptLineIds: readonly string[], o: { forUpdate: boolean }): Promise<BillPart[]> {
  if (receiptLineIds.length === 0) return [];
  const tx = purchasingTx(ctx);
  const rows = await tx.select({ billId: purchaseBills.id, billNumber: purchaseBills.number, billDate: purchaseBills.businessDate,
    owner: purchaseBills.createdBy, entryId: purchaseBills.postedEntryId, placeOfSupply: purchaseBills.placeOfSupply, total: purchaseBills.total,
    billLineId: purchaseBillLines.id, receiptLineId: purchaseBillLines.receiptLineId, qty: purchaseBillLines.qty, rate: purchaseBillLines.rate,
    gstRate: purchaseBillLines.gstRate })
    .from(purchaseBillLines).innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId))
    .where(and(inArray(purchaseBillLines.receiptLineId, [...new Set(receiptLineIds)]), eq(purchaseBills.status, 'posted')))
    .orderBy(desc(purchaseBills.businessDate), desc(purchaseBills.number), asc(purchaseBillLines.lineNo));
  for (const r of rows) ctx.see('purchasing:read', { owner: r.owner });
  const ids = [...new Set(rows.map((r) => r.billId))].sort();
  if (o.forUpdate && ids.length > 0) {
    await tx.select({ id: purchaseBills.id }).from(purchaseBills).where(inArray(purchaseBills.id, ids)).orderBy(asc(purchaseBills.id)).for('update');
  }
  // Input GST is reversed only where the bill claimed it (§7a): as its own entry posted it, not as the supplier is now.
  const claimed = await claimedInputGst(ctx, rows.flatMap((r) => (r.entryId === null ? [] : [r.entryId])));
  return rows.map((r) => ({ billId: r.billId, billNumber: r.billNumber ?? '', billDate: r.billDate, billLineId: r.billLineId,
    receiptLineId: r.receiptLineId ?? '', qty: dec(r.qty ?? '0'), rate: r.rate ?? '0', gstRate: r.gstRate, placeOfSupply: r.placeOfSupply ?? '',
    claimable: r.entryId !== null && claimed.has(r.entryId), total: r.total ?? '0' }));
}

type Debit = { billId: string; billNumber: string; billDate: string; billLineId: string; qty: Decimal; rate: string; gstRate: string | null;
  tax: LineTax; claimable: boolean; billTotal: string; placeOfSupply: string };
export type Split = { lineId: string; unbilledQty: Decimal; debits: Debit[] };
type ReturnLine = { id: string; receiptLineId: string; qty: string };

/**
 * Each return line split (§8): the unbilled part first, at most what's left unbilled of its receipt line (what came in,
 * less what posted bills billed, less what posted returns sent back unbilled), then the rest against its bills latest
 * first, each bill line at most what it billed less what earlier returns debited. A part past both is `over_received`.
 */
export async function splitLines(ctx: Ctx, lines: readonly ReturnLine[], received: ReadonlyMap<string, string>,
  o: { forUpdate: boolean }): Promise<Split[]> {
  const ids = lines.map((l) => l.receiptLineId);
  const parts = await billPartsOf(ctx, ids, o);
  const billed = await billedQty(ctx, ids);
  const back = await unbilledReturnedOf(ctx, ids);
  const used = await debitedOf(ctx, parts.map((p) => p.billLineId));
  const unbilled = new Map(ids.map((id) => {
    const left = dec(received.get(id) ?? '0').minus(billed.get(id) ?? zero()).minus(back.get(id) ?? zero());
    return [id, left.gt(0) ? left : zero()];
  }));
  const company = parts.length === 0 ? null : (await getCompanyProfile(ctx)).company;
  if (parts.length > 0 && company === null) {
    throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state to work out the debit note’s GST');
  }
  return lines.map((l, n) => {
    const free = unbilled.get(l.receiptLineId) ?? zero();
    const unbilledQty = minOf(dec(l.qty), free);
    unbilled.set(l.receiptLineId, free.minus(unbilledQty));
    let rest = dec(l.qty).minus(unbilledQty);
    const debits: Debit[] = [];
    for (const p of parts.filter((x) => x.receiptLineId === l.receiptLineId)) {
      if (!rest.gt(0)) break;
      const avail = p.qty.minus(used.get(p.billLineId) ?? zero());
      const take = minOf(rest, avail);
      if (!take.gt(0)) continue;
      used.set(p.billLineId, (used.get(p.billLineId) ?? zero()).plus(take));
      rest = rest.minus(take);
      debits.push({ billId: p.billId, billNumber: p.billNumber, billDate: p.billDate, billLineId: p.billLineId, qty: take, rate: p.rate,
        gstRate: p.gstRate, claimable: p.claimable, billTotal: p.total, placeOfSupply: p.placeOfSupply,
        tax: lineTax({ qty: take, rate: p.rate, discountPercent: '0', gstPercent: p.gstRate ?? '0' }, p.placeOfSupply === company?.stateCode) });
    }
    if (rest.gt(0)) {
      throw new AppError('over_received', 'More goes back than came in on that receipt line, less what has gone back already',
        [{ path: ['lines', n, 'qty'], code: 'over_received', message: 'Fewer go back' }]);
    }
    return { lineId: l.id, unbilledQty, debits };
  });
}

/** The debit note's totals, to the rupee as the bills it debits are (null when nothing on the return was billed). */
export function debitTotals(splits: readonly Split[]) {
  const debits = splits.flatMap((s) => s.debits);
  if (debits.length === 0) return null;
  const t = totalsOf(debits.map((d) => d.tax));
  return { placeOfSupply: debits[0]?.placeOfSupply ?? null, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff,
    total: t.total, claimed: totalsOf(debits.filter((d) => d.claimable).map((d) => d.tax)) };
}

/** Writes a posting return's debits (its parts, while it's still a draft). */
export async function writeDebits(ctx: Ctx, returnId: string, splits: readonly Split[]): Promise<void> {
  const rows = splits.flatMap((s) => s.debits.map((d) => ({ returnId, returnLineId: s.lineId, billId: d.billId, billLineId: d.billLineId,
    qty: d.qty.toFixed(3), rate: d.rate, gstRate: d.gstRate, taxable: d.tax.taxable, cgst: d.tax.cgst, sgst: d.tax.sgst, igst: d.tax.igst })));
  if (rows.length > 0) await purchasingTx(ctx).insert(supplierReturnDebits).values(rows);
}

/** Applies a posted debit note to the bills it debits (§8): each at most its share and what's open on it, within the
 * note's total; what's left stays as credit with the supplier. */
export async function applyToBills(ctx: Ctx, returnId: string, splits: readonly Split[], total: Money, businessDate: string): Promise<void> {
  const share = new Map<string, Decimal>();
  for (const d of splits.flatMap((s) => s.debits)) share.set(d.billId, (share.get(d.billId) ?? zero()).plus(dec(d.tax.lineTotal)));
  const bills = [...share.keys()].sort();
  const paid = await paidOf(ctx, 'purchase_bills', bills);
  const totals = new Map(splits.flatMap((s) => s.debits).map((d) => [d.billId, d.billTotal]));
  let left = dec(total);
  for (const billId of bills) {
    const open = dec(totals.get(billId) ?? '0').minus(dec(paid.get(billId)?.paid ?? '0'));
    const amount = minOf(minOf(share.get(billId) ?? zero(), open), left);
    if (!amount.gt(0)) continue;
    left = left.minus(amount);
    await applyCredit(ctx, { creditTable: SOURCE, creditId: returnId, documentTable: 'purchase_bills', documentId: billId,
      amount: roundMoney(amount), businessDate });
  }
}

/** Before a return is cancelled: its debit note's applications reversed, each once, dated the cancellation's day. */
export async function unapply(ctx: Ctx, returnId: string, businessDate: string, reason: string): Promise<void> {
  for (const a of await creditApplicationsOf(ctx, SOURCE, returnId)) {
    if (!a.reversed) await reverseCreditApplication(ctx, { id: a.id, businessDate, reason });
  }
}

/** Locks the bills a posted return debited, in id order, before its cancel reverses what it applied to them (§12). */
export async function lockDebitedBills(ctx: Ctx, returnId: string): Promise<void> {
  const tx = purchasingTx(ctx);
  const ids = [...new Set((await tx.select({ id: supplierReturnDebits.billId }).from(supplierReturnDebits)
    .where(eq(supplierReturnDebits.returnId, returnId))).map((r) => r.id))].sort();
  if (ids.length === 0) return;
  const bills = await tx.select({ id: purchaseBills.id, owner: purchaseBills.createdBy }).from(purchaseBills)
    .where(inArray(purchaseBills.id, ids)).orderBy(asc(purchaseBills.id)).for('update');
  for (const b of bills) ctx.see('purchasing:read', { owner: b.owner });
}

/** A posted return's stored debits, by line, for its reads: bill numbers only for bills the reader may see. */
export async function storedDebits(ctx: Ctx, returnId: string) {
  const rows = await purchasingTx(ctx).select({ lineId: supplierReturnDebits.returnLineId, billId: supplierReturnDebits.billId,
    billLineId: supplierReturnDebits.billLineId, qty: supplierReturnDebits.qty, rate: supplierReturnDebits.rate, gstRate: supplierReturnDebits.gstRate,
    taxable: supplierReturnDebits.taxable, cgst: supplierReturnDebits.cgst, sgst: supplierReturnDebits.sgst, igst: supplierReturnDebits.igst,
    number: purchaseBills.number, owner: purchaseBills.createdBy })
    .from(supplierReturnDebits).innerJoin(purchaseBills, eq(purchaseBills.id, supplierReturnDebits.billId))
    .where(eq(supplierReturnDebits.returnId, returnId)).orderBy(asc(supplierReturnDebits.id));
  return rows.map((r) => ({ ...r, billNumber: ctx.can('purchasing:read', { owner: r.owner }) ? r.number ?? '' : '' }));
}
