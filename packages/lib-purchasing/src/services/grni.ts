// Goods Received Not Billed by receipt line, for the books check (RAD-95; ADR-006 §7): what each posted receipt line
// accrued, and what's left of it once posted bills and unbilled supplier returns have cleared theirs. Every document
// counts, whoever made it, so this file reads past the record scope: E7's exemption, by the architect's ruling on RAD-95
// (ADR-001 §6a). Its rules, checked in review:
// - it answers only money sums keyed by receipt-line id: never a name, rate, quantity, document id or maker;
// - only the books check calls it, under journal:read; and the same for the bills' Job Work Charges to be Billed, by
//   job-work receipt line (RAD-142's jwcb_value).
// As at a date, a document counts from its own business date (its posting's) until its cancellation entry's date.
// shortcut: it reads every receipt, bill and return line on each check; bound it by date, or keep a per-line summary
// table, once the books check's time grows with the years of documents (the auditor on #398).
import { goodsReceiptLines, goodsReceipts, purchaseBillLines, purchaseBills, purchasingTx, supplierReturnLines, supplierReturns } from '@radcore/db/purchasing';
import { entryDates } from '@radcore/lib-accounts';
import { dec, roundMoney, type Decimal, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { eq, inArray } from 'drizzle-orm';

type Part = { line: string | null; value: string | null; date: string; cancelEntryId: string | null; status: string };

/** Which documents count as at `asAt`: posted by the date, and not cancelled by then (by its cancellation entry's date).
 * A cancelled document with no entry carried no value. */
async function counting(ctx: Ctx, parts: readonly Part[], asAt?: string): Promise<(p: Part) => boolean> {
  const dates = await entryDates(ctx, parts.flatMap((p) => (p.cancelEntryId === null ? [] : [p.cancelEntryId])));
  return (p) => (asAt === undefined || p.date <= asAt) && (p.status !== 'cancelled' || (asAt !== undefined
    && p.cancelEntryId !== null && (dates.get(p.cancelEntryId) ?? '') > asAt));
}

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
  const counts = await counting(ctx, [...receipts, ...billed, ...returned], asAt);
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

/** What posted bills have cleared of each job-work receipt line's charge (`jwcb_value`, RAD-142), as at `asAt`: Job Work
 * Charges to be Billed's documents side, with lib-stock's charges (the books check, RAD-95). */
export async function jwcbClearedByLine(ctx: Ctx, asAt?: string): Promise<Map<string, Money>> {
  const billed: Part[] = await purchasingTx(ctx).select({ line: purchaseBillLines.jobWorkReceiptLineId, value: purchaseBillLines.jwcbValue,
    date: purchaseBills.businessDate, cancelEntryId: purchaseBills.cancelEntryId, status: purchaseBills.status })
    .from(purchaseBillLines).innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillLines.billId))
    .where(inArray(purchaseBills.status, ['posted', 'cancelled']));
  const counts = await counting(ctx, billed, asAt);
  const cleared = new Map<string, Decimal>();
  for (const p of billed) if (p.line !== null && counts(p)) cleared.set(p.line, (cleared.get(p.line) ?? dec('0')).plus(dec(p.value ?? '0')));
  return new Map([...cleared].map(([line, v]) => [line, roundMoney(v)]));
}
