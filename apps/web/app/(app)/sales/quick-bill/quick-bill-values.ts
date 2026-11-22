// A quick bill as its form holds it (RAD-124 on RAD-115's contract): the date, the place, who it is for, its lines and its payments.
// A line holds its item, quantity, rate and discount, and (as a delivery's does) how many come from each batch (by the key
// stock-pick.tsx gives each) and its serials; it goes to the contract as batches with their quantities. A payment is cash, UPI
// (a bank payment into an account, with its reference) or a card (by the machine's approval code alone: card digits are refused
// here as the server refuses them). The checks are the contract's own; the tax, the total and what is left are the server's.
import { indiaDate, looksLikeCardNumber, moneyString, quantityString } from '@radcore/lib-common';
import { createQuickBill, holdQuickBill } from '@radcore/lib-sales/contract';
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
});
type PaymentBox = z.output<typeof payment>;

/** One payment as the contract takes it, with its issues at the boxes. A held bill's card carries no approval code yet: the machine's
 * code is given when the bill is completed, so a hold neither asks for it nor sends it. */
function mapPayment(p: PaymentBox, i: number, hold: boolean, ctx: z.RefinementCtx) {
  const at = (field: string, message: string) => ctx.addIssue({ code: 'custom', message, path: ['payments', i, field] });
  const amount = moneyString().safeParse(p.amount);
  if (!amount.success) at('amount', t('sales.quick.err.amount'));
  if (p.method === 'upi' && p.accountId === '') at('accountId', t('sales.quick.err.account'));
  if (p.method === 'upi' && p.reference !== '' && looksLikeCardNumber(p.reference)) at('reference', t('sales.quick.err.card.digits'));
  if (p.method === 'card' && !hold && p.approvalCode === '') at('approvalCode', t('sales.quick.err.approval'));
  if (p.method === 'card' && !hold && p.approvalCode !== '' && looksLikeCardNumber(p.approvalCode)) at('approvalCode', t('sales.quick.err.card.digits'));
  if (!amount.success) return z.NEVER;
  if (p.method === 'cash') return { method: 'cash' as const, amount: amount.data };
  if (p.method === 'card') return { method: 'card' as const, amount: amount.data, ...(hold ? {} : { approvalCode: p.approvalCode }) };
  return { method: 'bank' as const, amount: amount.data, accountId: p.accountId, ...(p.reference === '' ? {} : { reference: p.reference }) };
}

const buyerShape = holdQuickBill.input.shape.buyer.unwrap().shape;
/** A walk-in who leaves a balance (a hold, under sales:counter_credit): a name and a mobile, and the address a bill above the B2C limit
 * needs. Every box is text here; the pincode is checked with the contract's own rule, the rest when the hold is made. */
const buyerBox = z.object({ name: z.string().trim(), phone: z.string().trim(), addressLine1: z.string().trim(), city: z.string().trim(), pincode: z.string().trim() });

export const quickBillSchema = z.object({
  /** "save": the bill whole; "hold": held for an approval and completed once it is given. */
  mode: z.enum(['save', 'hold']),
  businessDate: shape.businessDate,
  locationId: z.string().min(1, t('sales.quick.err.place')).pipe(shape.locationId),
  customer: z.enum(['counter', 'named']),
  partyId: z.string(),
  buyer: buyerBox,
  notes: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(shape.notes),
  lines: z.array(line).min(1, t('sales.quick.line.none')).max(200, t('sales.lines.max')),
  payments: z.array(payment).max(10),
}).transform((v, ctx) => {
  if (v.customer === 'named' && v.partyId === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.party'), path: ['partyId'] });
  const bill = {
    ...(v.customer === 'named' ? { partyId: v.partyId } : {}), businessDate: v.businessDate, locationId: v.locationId, notes: v.notes, lines: v.lines,
    payments: v.payments.map((p, i) => mapPayment(p, i, v.mode === 'hold', ctx)),
  };
  const b = v.buyer;
  const named = v.mode === 'hold' && v.customer === 'counter' && (b.name !== '' || b.phone !== '');
  if (named && b.name === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.buyer.name'), path: ['buyer', 'name'] });
  if (named && b.phone === '') ctx.addIssue({ code: 'custom', message: t('sales.quick.err.buyer.phone'), path: ['buyer', 'phone'] });
  if (named && b.pincode !== '' && !buyerShape.pincode.safeParse(b.pincode).success) {
    ctx.addIssue({ code: 'custom', message: t('sales.quick.err.buyer.pincode'), path: ['buyer', 'pincode'] });
  }
  const buyer = named ? {
    name: b.name, phone: b.phone, ...(b.addressLine1 === '' ? {} : { addressLine1: b.addressLine1 }), ...(b.city === '' ? {} : { city: b.city }),
    ...(b.pincode === '' ? {} : { pincode: b.pincode }),
  } : undefined;
  return { mode: v.mode, bill, ...(buyer === undefined ? {} : { buyer }) };
});
export type QuickBillInput = z.input<typeof quickBillSchema>;
export type QuickBillValues = z.output<typeof quickBillSchema>;

export const blankLine = { itemId: '', qty: '1', rate: '', discountPercent: '0', pick: {}, serials: [] as string[] };
export const blankPayment = (method: (typeof PAYMENT_METHODS)[number]) => ({ method, amount: '', accountId: '', reference: '', approvalCode: '' });

/** What a new bill starts from: today, the Counter customer, one empty line, no payment. */
export const NEW_QUICK_BILL: QuickBillInput = {
  mode: 'save', businessDate: indiaDate(new Date()), locationId: '', customer: 'counter', partyId: '',
  buyer: { name: '', phone: '', addressLine1: '', city: '', pincode: '' }, notes: '', lines: [blankLine], payments: [],
};

/** The rate box after the list rate changes (the item, the customer or the day): the rate this box filled in itself, or an empty box,
 * takes the new list rate (none when there is none); a rate someone typed is never touched. `filled` is the rate the box put in. */
export function rateAfterPrice(current: string, filled: string | null, listRate: string | null): { rate: string; filled: string | null } {
  if (current !== '' && current !== filled) return { rate: current, filled };
  return listRate === null ? { rate: '', filled: null } : { rate: listRate, filled: listRate };
}

/** The rate box when the item or its list rate changes: a new item starts from an empty box (the rate was for the old one, filled or
 * typed), then the list rate rules apply; so a list rate that is already known fills it at once. */
export function rateFor(itemChanged: boolean, current: string, filled: string | null, listRate: string | null): { rate: string; filled: string | null } {
  return itemChanged ? rateAfterPrice('', null, listRate) : rateAfterPrice(current, filled, listRate);
}

/** Why a save was refused in a way a hold may answer: a check needs an approval, or the Counter customer was left a balance. */
export type Refusal = 'override' | 'walk_in' | null;

/** Whether the choice between saving and holding is drawn, and whether hold is its default. It is drawn when a check needs an approval
 * (the preview's issues), when a save was refused for one of the two reasons, and for the Counter customer when the payments leave a
 * balance and the person may leave one (sales:counter_credit). Hold is the default after a refusal a hold answers: a needs_override, or a
 * walk-in balance for someone who may leave one. When it is not drawn the mode is "save", so a hold chosen earlier doesn't linger. */
export function holdChoiceState(o: { issues: number; refused: Refusal; counter: boolean; mayCredit: boolean; leftOver: boolean }): { shown: boolean; holdByDefault: boolean } {
  const balance = o.counter && o.mayCredit && o.leftOver;
  const shown = o.issues > 0 || o.refused !== null || balance;
  return { shown, holdByDefault: shown && (o.refused === 'override' || (o.refused === 'walk_in' && o.mayCredit)) };
}
