// A filed invoice's buyer GSTIN corrected (M5-04, RAD-154; ADR-010 §5; CA-11), under gst:file. It posts nothing: the
// invoice keeps its frozen fields and its entry, and GSTR-1 reports the amendment in Table 9A of the month it's made.
//   locks (ADR-010 §13): ADR-009 §7's step 1 FOR SHARE (lockPeriod: the profile, the period lock, the filed-month row)
//   → the invoice FOR UPDATE, so two amendments of one invoice take turns and each sees the GSTIN the other left.
import { invoiceAmendments, salesTx } from '@radcore/db/sales';
import { lockPeriod, returnFiled } from '@radcore/lib-accounts';
import { financialYear } from '@radcore/lib-common';
import { AMENDMENT_LAST_DAY } from '@radcore/lib-gst';
import { AppError, type Ctx } from '@radcore/lib-platform';
import type { z } from 'zod';
import type { amendInvoice } from '../contract.ts';
import { today } from './document-lines.ts';
import { amendedGstinOf, invoiceOf, wrongStatus } from './invoices.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** POST /sales/invoices/:id/amendments (gst:file): a posted B2B invoice in a filed GSTR-1, its new GSTIN of the same
 * state (so its tax heads stand), until gst.amendment_last_day after its financial year ends. */
export async function amendInvoiceNow(ctx: Ctx, { id, gstin, reason }: In<typeof amendInvoice>): Promise<Out<typeof amendInvoice>> {
  await lockPeriod(ctx);
  const inv = await invoiceOf(ctx, id, 'gst:file', true);
  if (inv.status !== 'posted') throw wrongStatus(inv.status, 'amended');
  const old = (await amendedGstinOf(ctx, id)) ?? inv.buyerGstin;
  if (old === null) {
    throw new AppError('not_b2b', 'This invoice was to a buyer with no GSTIN: billing a registered buyer instead is a credit note and a new invoice');
  }
  if (gstin === old) throw new AppError('same_gstin', `This invoice’s GSTIN is already ${old}`);
  if (gstin.slice(0, 2) !== old.slice(0, 2)) {
    throw new AppError('amendment_changes_heads', 'The new GSTIN is of another state, which changes the tax heads: raise a credit note and a new invoice',
      [{ path: ['gstin'], code: 'amendment_changes_heads', message: 'Enter a GSTIN of the same state' }]);
  }
  if (!(await returnFiled(ctx, 'gstr1', inv.businessDate.slice(0, 7)))) {
    throw new AppError('not_filed', 'This invoice’s GSTR-1 isn’t filed yet: cancel it and raise it again instead');
  }
  const day = today();
  const lastDay = `${financialYear(inv.businessDate).end.slice(0, 4)}-${ctx.settings.get(AMENDMENT_LAST_DAY)}`;
  if (day > lastDay) throw new AppError('amendment_window_closed', `An invoice of this financial year could be amended until ${lastDay}`);
  const [row] = await salesTx(ctx).insert(invoiceAmendments).values({ invoiceId: id, businessDate: day, oldGstin: old, newGstin: gstin, reason })
    .returning({ id: invoiceAmendments.id });
  if (row === undefined) throw new Error('The amendment was not saved');
  return row;
}
