// Cancelling an invoice (M3-10, RAD-114; ADR-007 §6; ADR-006 §6, F10). Under invoices:cancel (no second factor,
// Sarthak 20 Nov). Refused while anything is applied to it, a receipt or a credit (net allocations and credit
// applications not zero: the user reverses those first, and the receipts themselves are never touched, RC-126), and
// while a credit note stands against it (the note is cancelled first, RAD-114 PR 2). Its
// entry is mirrored, dated the cancellation's day, so the cost goes back to Goods Delivered Not Invoiced and the
// deliveries it billed are open again, to invoice again or take back.
// shortcut: its month being filed (M5-08, CA-11) isn't refused yet; M5-08's filing record adds it.
import { invoiceLines, invoices, salesTx } from '@radcore/db/sales';
import { holdPeriod, paidOf, reverseEntry } from '@radcore/lib-accounts';
import { dec } from '@radcore/lib-common';
import { AppError, principalId, type Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { cancelInvoice } from '../contract.ts';
import { hasCreditNotes, holdDeliveriesOf } from './delivered.ts';
import { checkDate } from './document-rules.ts';
import { today } from './document-lines.ts';
import { invoiceOf, wrongStatus } from './invoices.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** POST /sales/invoices/:id/cancel (invoices:cancel). In ADR-006 §1's order: the period (and the company profile), the
 * invoice, then the deliveries it billed by id, so a return or another invoice of them waits for the cancellation. */
export async function cancelInvoiceNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelInvoice>): Promise<Out<typeof cancelInvoice>> {
  await holdPeriod(ctx, businessDate);
  const inv = await invoiceOf(ctx, id, 'invoices:cancel', true);
  if (inv.status !== 'posted' || inv.postedEntryId === null) throw wrongStatus(inv.status, 'cancelled');
  checkDate(businessDate, today(), { date: inv.businessDate, what: 'invoice' });
  const tx = salesTx(ctx);
  const billed = await tx.select({ id: invoiceLines.deliveryLineId }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  await holdDeliveriesOf(ctx, billed.map((b) => b.id));
  // A note posts under the invoice's lock, which this holds, so none can post in between.
  if (await hasCreditNotes(ctx, id)) throw new AppError('credit_note_stands', 'A credit note stands against this invoice: cancel it first');
  // Said by name first; the database's guard_applied_cancel refuses it too (document_still_applied).
  if (!dec((await paidOf(ctx, 'invoices', [id])).get(id)?.paid ?? '0').isZero()) {
    throw new AppError('still_applied', 'Payments or credits are still applied to this invoice: reverse them first');
  }
  const mirror = await reverseEntry(ctx, { entryId: inv.postedEntryId, businessDate, reason });
  await tx.update(invoices).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal), cancelReason: reason,
    cancelEntryId: mirror.id }).where(eq(invoices.id, id));
  return {};
}
