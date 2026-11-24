// The job-work receipt lines a purchase bill names (M4-03's follow-up on RAD-142; ADR-008 §7, §11, §12), reached by no
// route: what each line made, at what charge rate, and what its charge accrued to Job Work Charges to be Billed, which
// the job worker's bill clears. A receipt the principal can't read under stock:read is left out, as if there were none.
import { jobWorkChallans, jobWorkReceiptLines, jobWorkReceipts, stockTx } from '@radcore/db/stock';
import { listScope, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray } from 'drizzle-orm';

/** These job-work receipt lines, with their receipt, its job worker and where the made goods came in. Locked when
 * `lock` says (FOR UPDATE to post a bill, FOR SHARE to save a draft), after the bill's POs and goods receipts and before
 * the bill (ADR-008 §12): the receipts in id order. */
export async function jobWorkLinesFor(ctx: Ctx, lineIds: readonly string[], o: { lock: 'update' | 'share' | false }) {
  // No stock:read at all: none of them is seen, as listScope would otherwise refuse the bill's own read (the auditor on #408).
  if (lineIds.length === 0 || !ctx.principal.permissions.includes('stock:read')) return [];
  const tx = stockTx(ctx);
  const q = tx.select({ id: jobWorkReceiptLines.id, receiptId: jobWorkReceipts.id, receiptNumber: jobWorkReceipts.number,
    receiptDate: jobWorkReceipts.businessDate, status: jobWorkReceipts.status, partyId: jobWorkChallans.partyId,
    locationId: jobWorkReceipts.locationId, madeItemId: jobWorkReceiptLines.madeItemId, madeQty: jobWorkReceiptLines.madeQty,
    chargeRate: jobWorkReceiptLines.chargeRate, charge: jobWorkReceiptLines.charge })
    .from(jobWorkReceiptLines).innerJoin(jobWorkReceipts, eq(jobWorkReceipts.id, jobWorkReceiptLines.receiptId))
    .innerJoin(jobWorkChallans, eq(jobWorkChallans.id, jobWorkReceipts.challanId))
    .where(and(inArray(jobWorkReceiptLines.id, [...new Set(lineIds)]), listScope(ctx, 'stock:read', jobWorkReceipts.createdBy)))
    .orderBy(asc(jobWorkReceipts.id), asc(jobWorkReceiptLines.lineNo));
  if (o.lock === false) return q;
  // Only the receipts' own rows, as receiptLinesFor takes goods receipts' (the auditor on #380): FOR UPDATE on the join
  // would take the challans too, out of §12's order.
  const receiptIds = [...new Set((await q).map((r) => r.receiptId))].sort();
  if (receiptIds.length > 0) {
    await tx.select({ id: jobWorkReceipts.id }).from(jobWorkReceipts).where(inArray(jobWorkReceipts.id, receiptIds)).orderBy(asc(jobWorkReceipts.id)).for(o.lock);
  }
  // Read again under the lock, so each receipt's status is the one now held.
  return await q;
}
