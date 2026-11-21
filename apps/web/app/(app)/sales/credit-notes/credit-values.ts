// What a credit note's form holds and how it goes to the contract (RAD-125): a value credit, the taxable value credited on each
// invoice line it names, and an optional counter refund. Goods back (a quantity and the batches they come back in) isn't written
// here yet: it needs the batches the goods left with, which an invoice line doesn't carry.
import { indiaDate, moneyString } from '@radcore/lib-common';
import { createCreditNote } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createCreditNote.input.shape;
const lineShape = shape.lines.element.shape;
const amountBox = z.string().trim().refine((v) => v === '' || moneyString().safeParse(v).success, t('sales.credit.err.amount'));

// A line as the form holds it: the invoice line, its item's label and what it was invoiced at (to show), and the taxable
// value to credit, empty for a line that isn't credited.
const line = z.object({
  invoiceLineId: lineShape.invoiceLineId, itemId: z.string(), label: z.string(), invoiced: z.string(), taxable: amountBox,
});

export const creditSchema = z.object({
  invoiceId: z.string().min(1, t('sales.credit.form.invoice.none')).pipe(shape.invoiceId),
  businessDate: shape.businessDate,
  reason: shape.reason,
  refundAmount: amountBox,
  refundAccountId: z.string(),
  lines: z.array(line).min(1, t('sales.credit.form.lines.none')).max(200, t('sales.lines.max')),
}).transform((v, ctx) => {
  const lines = v.lines.filter((l) => l.taxable !== '').map((l) => ({ invoiceLineId: l.invoiceLineId, taxable: moneyString().parse(l.taxable) }));
  if (lines.length === 0) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.nothing'), path: ['lines'] });
  const named = [v.refundAmount !== '', v.refundAccountId !== ''];
  if (named[0] !== named[1]) ctx.addIssue({ code: 'custom', message: t('sales.credit.err.refund'), path: [named[0] ? 'refundAccountId' : 'refundAmount'] });
  const refund = named[0] && named[1] ? { amount: moneyString().parse(v.refundAmount), accountId: v.refundAccountId } : null;
  // A value credit: no goods and no place (the contract's own rule for the other kind).
  return { invoiceId: v.invoiceId, kind: 'value' as const, businessDate: v.businessDate, locationId: null, reason: v.reason, refund, lines };
});
export type CreditInput = z.input<typeof creditSchema>;
export type CreditValues = z.output<typeof creditSchema>;
export type CreditLineInput = CreditInput['lines'][number];

/** What a new credit note starts from: today, nothing chosen. */
export const NEW_CREDIT: CreditInput = { invoiceId: '', businessDate: indiaDate(new Date()), reason: '', refundAmount: '', refundAccountId: '', lines: [] };
