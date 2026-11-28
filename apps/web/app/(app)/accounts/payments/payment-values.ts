// A payment as its form holds it (RAD-126 on RAD-116's contract): a receipt (money in from a customer) or a payment (out to a supplier),
// its party, date, amount, its TDS (a receipt's as the customer held it back; a payment's worked out by the server from the section
// picked, a typed figure only checking it, RAD-158), the money account, and the money's own trail (an approval code, a UTR, a cheque number),
// which is never card digits: that is refused here as the server refuses it. Refunds wait for the payments list (they name a receipt).
// The allocation form holds an amount against each open bill. The checks are the contract's own.
import { dec, indiaDate, looksLikeCardNumber, moneyString } from '@radcore/lib-common';
import { allocatePaymentContract, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = recordPaymentContract.input.shape;

/** An amount of money more than zero: the hint says so, and the server refuses a nought (e2e-2 on #348). */
const positive = (a: string) => moneyString().safeParse(a).success && dec(a).gt(0);

export const PAYMENT_KINDS = ['receipt', 'payment'] as const;
/** A TDS section as a picker offers it, with the kind of payee it's for (auditor-3 on #472). */
export const sectionLabel = (s: { code: string; name: string; payee: 'individual' | 'other' | 'any' }) =>
  `${s.code}: ${s.name} (${t(`books.pay.payee.${s.payee}`)})`;
const hasTdsBox = (v: { kind: (typeof PAYMENT_KINDS)[number]; tdsSectionId: string }) => v.kind === 'receipt' || v.tdsSectionId !== '';

export const paymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  partyId: z.string().min(1, t('books.pay.party.none')).pipe(shape.partyId),
  businessDate: shape.businessDate,
  amount: z.string().trim().refine(positive, t('books.pay.err.amount')).pipe(shape.amount),
  tds: z.string().trim(),
  tdsSectionId: z.string(),
  accountId: z.string().min(1, t('books.pay.err.account')).pipe(shape.accountId),
  reference: z.string().trim().refine((r) => !looksLikeCardNumber(r), t('books.pay.err.card.digits')),
  narration: z.string().trim(),
})
  // The TDS box is checked and sent only where it's shown: a receipt, or a payment under a section.
  .refine((v) => !hasTdsBox(v) || v.tds === '' || moneyString().safeParse(v.tds).success, { path: ['tds'], message: t('books.pay.err.tds') })
  .transform((v) => ({
    kind: v.kind, partyId: v.partyId, businessDate: v.businessDate, amount: v.amount, accountId: v.accountId,
    ...(v.kind === 'payment' && v.tdsSectionId !== '' ? { tdsSectionId: v.tdsSectionId } : {}),
    ...(hasTdsBox(v) && v.tds !== '' ? { tds: v.tds } : {}),
    ...(v.reference === '' ? {} : { reference: v.reference }), ...(v.narration === '' ? {} : { narration: v.narration }),
  }));
export type PaymentInput = z.input<typeof paymentSchema>;
export type PaymentValues = z.output<typeof paymentSchema>;

export const NEW_PAYMENT: PaymentInput = {
  kind: 'receipt', partyId: '', businessDate: indiaDate(new Date()), amount: '', tds: '', tdsSectionId: '', accountId: '', reference: '', narration: '',
};

const lineShape = allocatePaymentContract.input.shape.lines.element.shape;

/** One open bill's box: what the receipt pays of it (empty: none). */
const allocation = z.object({ documentTable: lineShape.documentTable, documentId: lineShape.documentId, amount: z.string().trim()
  .refine((a) => a === '' || positive(a), t('books.pay.allocate.err.amount')) });

export const allocateSchema = z.object({ businessDate: allocatePaymentContract.input.shape.businessDate, lines: z.array(allocation) })
  .transform((v, ctx) => {
    const lines = v.lines.filter((l) => l.amount !== '').map((l) => ({ documentTable: l.documentTable, documentId: l.documentId, amount: l.amount }));
    if (lines.length === 0) ctx.addIssue({ code: 'custom', message: t('books.pay.allocate.err.none'), path: ['lines'] });
    return { businessDate: v.businessDate, lines };
  });
export type AllocateInput = z.input<typeof allocateSchema>;

/** A refund of a receipt: the amount, the account it is paid from, the date and the reference; the party and the receipt are the receipt's. */
export const refundSchema = z.object({
  businessDate: shape.businessDate,
  amount: z.string().trim().refine(positive, t('books.pay.err.amount')).pipe(shape.amount),
  accountId: z.string().min(1, t('books.pay.err.account')).pipe(shape.accountId),
  reference: z.string().trim().refine((r) => !looksLikeCardNumber(r), t('books.pay.err.card.digits')),
}).transform((v) => ({ businessDate: v.businessDate, amount: v.amount, accountId: v.accountId, ...(v.reference === '' ? {} : { reference: v.reference }) }));
