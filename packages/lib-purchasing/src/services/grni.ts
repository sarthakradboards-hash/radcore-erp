// Goods Received Not Billed by receipt line, for the books check (RAD-95; ADR-006 §7): what each posted receipt line
// accrued, and what's left of it once posted bills and unbilled supplier returns have cleared theirs. Every document
// counts, whoever made it, so this file reads past the record scope: E7's exemption, by the architect's ruling on RAD-95
// (ADR-001 §6a). Its rules, checked in review:
// - it answers only money sums keyed by receipt-line id: never a name, rate, quantity, document id or maker;
// - only the books check calls it, under journal:read.
// As at a date, a document counts from its own business date (its posting's) until its cancellation entry's date.
import { goodsReceiptLines, goodsReceipts, purchaseBillLines, purchaseBills, purchasingTx, supplierReturnLines, supplierReturns } from '@radcore/db/purchasing';
import { entryDates } from '@radcore/lib-accounts';
import { dec, roundMoney, type Decimal, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { eq, inArray } from 'drizzle-orm';

type Part = { line: string | null; value: string | null; date: string; cancelEntryId: string | null; status: string };

/** Each receipt line's accrual and what's still open of it, as at `asAt` (now when it's left out). */
export async function grniByReceiptLine(ctx: Ctx, asAt?: string): Promise<{ receiptLineId: string; accrued: Money; open: Money }[]> {
  const tx = purchasingTx(ctx);
  const done = ['posted', 'cancelled'];
  const accrued = await tx.select({ line: goodsReceiptLines.id, accepted: goodsReceiptLines.acceptedValue, rejected: goodsReceiptLines.rejectedValue,
    date: goodsReceipts.businessDate, cancelEntryId: goodsReceipts.cancelEntryId, status: goodsReceipts.status })
    .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId)).where(inArray(goodsReceipts.status, done));
  const billed: Part[] = await tx.select({ line: purchaseBillLines.receiptLineId, value: purchaseBillLines.grniValue,
    date: purchaseBills.businessDate, cancelEntryId: purchaseBills.cancelEntryId, status: purchaseBills.status })
    .from(purchaseBillLines).innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId)).where(inArray(purchaseBills.status, done));
  const returned: Part[] = await tx.select({ line: supplierReturnLines.receiptLineId, value: supplierReturnLines.unbilledValue,
    date: supplierReturns.businessDate, cancelEntryId: supplierReturns.cancelEntryId, status: supplierReturns.status })
    .from(supplierReturnLines).innerJoin(supplierReturns, eq(supplierReturns.id, supplierReturnLines.returnId))
    .where(inArray(supplierReturns.status, done));
  const receipts: Part[] = accrued.map((r) => ({ ...r, value: dec(r.accepted ?? '0').plus(dec(r.rejected ?? '0')).toString() }));
  const dates = await entryDates(ctx, [...receipts, ...billed, ...returned].flatMap((p) => (p.cancelEntryId === null ? [] : [p.cancelEntryId])));
  // Posted by the date, and not cancelled by then. A cancelled document with no entry carried no value.
  const counts = (p: Part) => (asAt === undefined || p.date <= asAt) && (p.status !== 'cancelled' || (asAt !== undefined
    && p.cancelEntryId !== null && (dates.get(p.cancelEntryId) ?? '') > asAt));
  const lines = new Map<string, { accrued: Decimal; open: Decimal }>();
  const add = (parts: readonly Part[], sign: 1 | -1, isAccrual: boolean) => {
    for (const p of parts) {
      if (p.line === null || !counts(p)) continue;
      const v = dec(p.value ?? '0');
      const l = lines.get(p.line) ?? { accrued: dec('0'), open: dec('0') };
      lines.set(p.line, { accrued: isAccrual ? l.accrued.plus(v) : l.accrued, open: l.open.plus(v.times(sign)) });
    }
  };
  add(receipts, 1, true);
  add(billed, -1, false);
  add(returned, -1, false);
  return [...lines].map(([receiptLineId, l]) => ({ receiptLineId, accrued: roundMoney(l.accrued), open: roundMoney(l.open) }));
}
