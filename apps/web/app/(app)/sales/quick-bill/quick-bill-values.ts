// A quick bill as its form holds it (RAD-124 on RAD-115's contract): the date, the place, who it is for, its lines and its payments.
// A line holds its item, quantity, rate and discount, and (as a delivery's does) how many come from each batch (by the key
// stock-pick.tsx gives each) and its serials; it goes to the contract as batches with their quantities. A payment is cash, UPI
// (a bank payment into an account, with its reference) or a card (by the machine's approval code alone: card digits are refused
// here as the server refuses them). The checks are the contract's own; the tax, the total and what is left are the server's.
import { indiaDate, looksLikeCardNumber, moneyString, quantityString } from '@radcore/lib-common';
import { createQuickBill } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createQuickBill.input.shape;
const lineShape = shape.lines.element.shape;
const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('sales.quick.err.qty'));

const line = z.object({
  itemId: z.string().min(1, t('sales.quick.line.item.none')).pipe(lineShape.itemId),
  qty: lineShape.qty, rate: lineShape.rate, discountPercent: lineShape.discountPercent,
  pick: z.record(z.string(), qtyBox), serials: z.array(z.string()),
}).transform((l, ctx) => {
  const batches = Object.entries(l.pick).filter(([, qty]) => qty !== '').map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty }));
  if (batches.length === 0) {
    // On the quantity box, a field that is always drawn: `pick` itself has no box.
    ctx.addIssue({ code: 'custom', message: t('sales.quick.err.pick'), path: ['qty'] });
    return z.NEVER;
  }
  return { itemId: l.itemId, qty: l.qty, rate: l.rate, discountPercent: l.discountPercent, batches, serials: l.serials };
});

export const PAYMENT_METHODS = ['cash', 'upi', 'card'] as const;
const payment = z.object({
  method: z.enum(PAYMENT_METHODS), amount: z.string().trim(), accountId: z.string(), reference: z.string().trim(), approvalCode: z.string().trim(),
}).transform((p, ctx) => {
  const amount = moneyString().safeParse(p.amount);
  if (!amount.success) ctx.addIssue({ code: 'custom', message: t('sales.quick.err.amount'), path: ['amount'] });
  if (p.method === 'upi' && p.accountId === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.account'), path: ['accountId'] });
  if (p.method === 'upi' && p.reference !== '' && looksLikeCardNumber(p.reference)) {
    ctx.addIssue({ code: 'custom', message: t('sales.quick.err.card.digits'), path: ['reference'] });
  }
  if (p.method === 'card' && p.approvalCode === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.approval'), path: ['approvalCode'] });
  if (p.method === 'card' && p.approvalCode !== '' && looksLikeCardNumber(p.approvalCode)) {
    ctx.addIssue({ code: 'custom', message: t('sales.quick.err.card.digits'), path: ['approvalCode'] });
  }
  if (!amount.success) return z.NEVER;
  if (p.method === 'cash') return { method: 'cash' as const, amount: amount.data };
  if (p.method === 'card') return { method: 'card' as const, amount: amount.data, approvalCode: p.approvalCode };
  return { method: 'bank' as const, amount: amount.data, accountId: p.accountId, ...(p.reference === '' ? {} : { reference: p.reference }) };
});

export const quickBillSchema = z.object({
  businessDate: shape.businessDate,
  locationId: z.string().min(1, t('sales.quick.err.place')).pipe(shape.locationId),
  customer: z.enum(['counter', 'named']),
  partyId: z.string(),
  notes: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(shape.notes),
  lines: z.array(line).min(1, t('sales.quick.line.none')).max(200, t('sales.lines.max')),
  payments: z.array(payment).max(10),
}).transform((v, ctx) => {
  if (v.customer === 'named' && v.partyId === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.party'), path: ['partyId'] });
  return {
    ...(v.customer === 'named' ? { partyId: v.partyId } : {}), businessDate: v.businessDate, locationId: v.locationId, notes: v.notes, lines: v.lines,
    payments: v.payments,
  };
});
export type QuickBillInput = z.input<typeof quickBillSchema>;
export type QuickBillValues = z.output<typeof quickBillSchema>;

export const blankLine = { itemId: '', qty: '1', rate: '', discountPercent: '0', pick: {}, serials: [] as string[] };
export const blankPayment = (method: (typeof PAYMENT_METHODS)[number]) => ({ method, amount: '', accountId: '', reference: '', approvalCode: '' });

/** What a new bill starts from: today, the Counter customer, one empty line, no payment. */
export const NEW_QUICK_BILL: QuickBillInput = {
  businessDate: indiaDate(new Date()), locationId: '', customer: 'counter', partyId: '', notes: '', lines: [blankLine], payments: [],
};
