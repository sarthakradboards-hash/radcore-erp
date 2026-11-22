// What a credit note's form holds and how it goes to the contract (RAD-125): a value credit (the taxable value credited on each
// invoice line it names) or goods back (a quantity, the batches they come back into and, for a serialised item, the serials, to
// a place), and an optional counter refund. The batches and units on offer are the invoice line's own (`goods`): the batches its
// goods left in and its units still out, each with the batch it left in.
import { indiaDate, moneyString, quantityString, sum } from '@radcore/lib-common';
import { createCreditNote } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createCreditNote.input.shape;
const lineShape = shape.lines.element.shape;
const amountBox = z.string().trim().refine((v) => v === '' || moneyString().safeParse(v).success, t('sales.credit.err.amount'));
const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('sales.credit.err.qty'));

/** The key a batch's quantity box has in the form: the batch's id, or "unknown" for goods whose batch wasn't known. */
export const batchKey = (batchId: string | null) => batchId ?? 'unknown';

// A line as the form holds it: the invoice line, its item's label and what it was invoiced at (to show), and what is credited: a
// taxable value (value credit), or a quantity with how many go back into each batch (by batchKey) and the serials (goods back).
const line = z.object({
  invoiceLineId: lineShape.invoiceLineId, itemId: z.string(), label: z.string(), invoiced: z.string(), taxable: amountBox,
  qty: qtyBox, pick: z.record(z.string(), qtyBox), serials: z.array(z.string()),
});

export const creditSchema = z.object({
  invoiceId: z.string().min(1, t('sales.credit.form.invoice.none')).pipe(shape.invoiceId),
  kind: z.enum(['value', 'goods']),
  businessDate: shape.businessDate,
  reason: shape.reason,
  locationId: z.string(),
  // Nested like the contract's, so the server's refusals at refund.amount and refund.accountId land on these boxes.
  refund: z.object({ amount: amountBox, accountId: z.string() }),
  lines: z.array(line).min(1, t('sales.credit.form.lines.none')).max(200, t('sales.lines.max')),
}).transform((v, ctx) => {
  const named = [v.refund.amount !== '', v.refund.accountId !== ''];
  if (named[0] !== named[1]) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.refund'), path: ['refund', named[0] ? 'accountId' : 'amount'] });
  const refund = named[0] && named[1] ? { amount: moneyString().parse(v.refund.amount), accountId: v.refund.accountId } : null;
  if (v.kind === 'value') {
    const lines = v.lines.filter((l) => l.taxable !== '').map((l) => ({ invoiceLineId: l.invoiceLineId, taxable: moneyString().parse(l.taxable) }));
    if (lines.length === 0) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.nothing'), path: ['lines'] });
    return { invoiceId: v.invoiceId, kind: 'value' as const, businessDate: v.businessDate, locationId: null, reason: v.reason, refund, lines };
  }
  if (v.locationId === '') ctx.addIssue({ code: 'custom', message: t('sales.credit.err.place'), path: ['locationId'] });
  const lines = v.lines.flatMap((l, i) => {
    if (l.qty === '') return [];
    const batches = Object.entries(l.pick).filter(([, qty]) => qty !== '')
      .map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty: quantityString().parse(qty) }));
    // On the quantity box, a field that is always drawn: `pick` itself has no box.
    if (batches.length === 0) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.pick'), path: ['lines', i, 'qty'] });
    // The batches must add up to the quantity, as the hint says; the server checks again, but only at approval.
    else if (!sum(batches.map((b) => b.qty)).eq(l.qty)) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.batches_mismatch'), path: ['lines', i, 'qty'] });
    return [{ invoiceLineId: l.invoiceLineId, qty: quantityString().parse(l.qty), batches, ...(l.serials.length === 0 ? {} : { serials: l.serials }) }];
  });
  if (lines.length === 0) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.nothing.goods'), path: ['lines'] });
  return { invoiceId: v.invoiceId, kind: 'goods' as const, businessDate: v.businessDate, locationId: v.locationId === '' ? null : v.locationId,
    reason: v.reason, refund, lines };
});
export type CreditInput = z.input<typeof creditSchema>;
export type CreditValues = z.output<typeof creditSchema>;
export type CreditLineInput = CreditInput['lines'][number];

/** What a new credit note starts from: a value credit, today, nothing chosen. */
export const NEW_CREDIT: CreditInput = { invoiceId: '', kind: 'value', businessDate: indiaDate(new Date()), reason: '', locationId: '',
  refund: { amount: '', accountId: '' }, lines: [] };
