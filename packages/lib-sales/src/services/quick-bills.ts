// The quick bill (M3-11, RAD-115; ADR-006 §6; the architect's rulings): the counter sale in one transaction, through
// each stage's own service, never a copy of it. Receipts first, so every stage's credit check sees only what's left
// unpaid (an advance lowers the party's balance, ADR-007 §9); then the order, confirmed; its delivery from one place,
// posted; its invoice, shipped to the shop, posted; and every receipt applied to that invoice. Any refusal on the way
// rolls all of it back.
import { deliveryLines, salesOrderLines, salesTx } from '@radcore/db/sales';
import { allocatePayment, companyForInvoice, moneyAccountRefusal, recordPayment, systemAccountId, systemPartyId } from '@radcore/lib-accounts';
import { dec, roundMoney, sum } from '@radcore/lib-common';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { createQuickBill } from '../contract.ts';
import { addDelivery, postDeliveryNow } from './deliveries.ts';
import { postInvoiceNow } from './invoice-post.ts';
import { addInvoice } from './invoices.ts';
import { addCounterOrder, confirmOrderNow, getOrderById } from './orders.ts';
import { looksLikeCardNumber } from './quick-bill-rules.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Payment = In<typeof createQuickBill>['payments'][number];

/** Where a card machine's money lands (Sarthak, 22 Nov): the seeded Card settlements account while it's unset, which a
 * manual journal empties into the bank, the machine's fee as an expense; or straight to a bank account. */
export const CARD_ACCOUNT = defineSetting('sales.card_account', z.uuid().nullable(), null, {
  label: 'Account for card payments',
  description: 'Where the counter’s card payments go. Unset, they go to Card settlements, moved to the bank by a journal with the machine’s fee.',
  input: { kind: 'reference', record: 'account' },
  check: async (ctx, id) => (id === null ? null : moneyAccountRefusal(ctx, id)),
});

/** The keys the stages check, each by its own service: all named at once, before anything is written (the architect). */
const KEYS = ['sales:write', 'deliveries:write', 'invoices:write'] as const;

/** A card's approval code: required, and never card digits (Sarthak; the architect's ruling). */
function cardCode(p: Extract<Payment, { method: 'card' }>, n: number): string {
  const path = ['payments', n, 'approvalCode'];
  if (p.approvalCode === undefined) {
    throw new AppError('approval_code_required', 'A card payment needs the card machine’s approval code',
      [{ path, code: 'approval_code_required', message: 'Type the approval code from the machine’s slip' }]);
  }
  if (looksLikeCardNumber(p.approvalCode)) {
    throw new AppError('looks_like_card_number', 'That looks like a card number: type the approval code, never the card’s digits',
      [{ path, code: 'looks_like_card_number', message: 'Type the approval code, not the card number' }]);
  }
  return p.approvalCode;
}

/** The receipts to take: the cash as one (so the Counter customer's cash limit is this bill's, RAD-115), each card
 * payment and each bank payment on its own, with its reference. */
async function receiptsOf(ctx: Ctx, payments: readonly Payment[]) {
  for (const [n, p] of payments.entries()) {
    if (!dec(p.amount).gt(0)) {
      throw new AppError('no_payment_amount', 'Each payment is more than 0', [{ path: ['payments', n, 'amount'], code: 'no_payment_amount',
        message: 'Type what was paid, or remove the payment' }]);
    }
  }
  const cash = payments.filter((p) => p.method === 'cash');
  const card = ctx.settings.get(CARD_ACCOUNT) ?? await systemAccountId(ctx, 'card_settlements');
  return [
    ...(cash.length === 0 ? [] : [{ accountId: await systemAccountId(ctx, 'cash'), amount: roundMoney(sum(cash.map((p) => p.amount))),
      reference: undefined }]),
    ...payments.flatMap((p, n) => p.method === 'card' ? [{ accountId: card, amount: p.amount, reference: cardCode(p, n) }]
      : p.method === 'bank' ? [{ accountId: p.accountId, amount: p.amount, reference: p.reference }] : []),
  ];
}

/** POST /sales/quick-bills (invoices:write, and the stages' keys): the counter sale, whole. */
export async function quickBill(ctx: Ctx, input: In<typeof createQuickBill>): Promise<Out<typeof createQuickBill>> {
  const missing = KEYS.filter((k) => !ctx.can(k));
  if (missing.length > 0) throw new AppError('forbidden', `A quick bill needs ${missing.join(', ')}`);
  const walkIn = await systemPartyId(ctx, 'walk_in');
  const partyId = input.partyId ?? walkIn;
  const { businessDate } = input;
  const taken = await receiptsOf(ctx, input.payments);
  // The quick bill's receipts go through lib-accounts under its own keys, not payments:write, as a booking's advance
  // does (the architect on RAD-115). Receipts only, never a payment out or a refund; at most the bill (`overpaid`); each
  // applied to this bill's invoice below, before the save ends; and cash still within the day's limit.
  const receipts = [];
  for (const r of taken) {
    const made = await recordPayment(ctx, { kind: 'receipt', partyId, businessDate, amount: r.amount, accountId: r.accountId,
      narration: 'Quick bill', ...(r.reference === undefined ? {} : { reference: r.reference }) });
    if (made.status !== 'posted' || made.number === null) {
      throw new AppError('cash_over_limit', 'That’s more cash than may be taken from one person in a day (section 269ST): take the rest by UPI, card or bank',
        [{ path: ['payments'], code: 'cash_over_limit', message: 'Take less in cash' }]);
    }
    receipts.push({ id: made.id, number: made.number, amount: r.amount });
  }
  const order = await addCounterOrder(ctx, { partyId, businessDate, notes: input.notes,
    lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discountPercent: l.discountPercent })) });
  // The Counter customer never carries credit (the architect on RAD-115): credit means a named party, so a walk-in bill
  // is paid in full, judged on the order's total, rounded to the rupee as its invoice's will be, before any check runs.
  // A total that can't be worked out yet (a missing GST rate) is confirming's to refuse, by name.
  if (partyId === walkIn) {
    const { total } = (await getOrderById(ctx, order)).amounts;
    if (total !== null && dec(sum(receipts.map((r) => r.amount))).lt(total)) {
      throw new AppError('walk_in_pays_in_full', `The Counter customer pays the whole bill of ${total}: name the party to sell on credit`,
        [{ path: ['payments'], code: 'walk_in_pays_in_full', message: `Take ${total} in all, or choose a named party` }]);
    }
  }
  const confirmed = await confirmOrderNow(ctx, order);
  const tx = salesTx(ctx);
  const orderLines = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const delivery = await addDelivery(ctx, { orderId: order.id, locationId: input.locationId, businessDate, notes: null,
    lines: input.lines.map((l, i) => ({ orderLineId: orderLines[i]?.id ?? '', qty: l.qty, batches: l.batches, serials: l.serials })) });
  const delivered = await postDeliveryNow(ctx, delivery);
  const billed = await tx.select({ id: deliveryLines.id }).from(deliveryLines)
    .where(eq(deliveryLines.deliveryId, delivery.id)).orderBy(asc(deliveryLines.lineNo));
  // Shipped to the shop: the goods are handed over at the counter, so its tax is the counter's, whoever buys (the
  // architect on RAD-115; CA-08's default until the CA answers).
  const shop = await companyForInvoice(ctx);
  const invoice = await addInvoice(ctx, { partyId, businessDate, notes: null, shipTo: { name: shop.legalName,
    address: [shop.addressLine1, shop.addressLine2, shop.city, shop.pincode].filter((s) => s !== null && s !== '').join(', '),
    stateCode: shop.stateCode }, lines: input.lines.map((l, i) => ({ deliveryLineId: billed[i]?.id ?? '', qty: l.qty })) });
  const posted = await postInvoiceNow(ctx, invoice);
  const paid = roundMoney(sum(receipts.map((r) => r.amount)));
  if (dec(paid).gt(posted.total)) {
    throw new AppError('overpaid', `That’s more than the bill of ${posted.total}`, [{ path: ['payments'], code: 'overpaid', message: 'Pay at most the bill' }]);
  }
  // Every receipt applied to this bill's invoice, so the quick bill leaves no advance standing (the architect).
  for (const r of receipts) {
    await allocatePayment(ctx, { id: r.id, businessDate, lines: [{ documentTable: 'invoices', documentId: invoice.id, amount: r.amount }] });
  }
  return { order: { id: order.id, number: confirmed.number }, delivery: { id: delivery.id, number: delivered.number },
    invoice: { id: invoice.id, number: posted.number }, receipts: receipts.map(({ id, number }) => ({ id, number })),
    total: posted.total, paid, left: roundMoney(dec(posted.total).minus(paid)) };
}
