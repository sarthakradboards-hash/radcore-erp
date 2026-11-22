// The quick bill (M3-11, RAD-115; ADR-006 §6; the architect's rulings): the counter sale in one transaction, through
// each stage's own service, never a copy of it. Receipts first, so every stage's credit check sees only what's left
// unpaid (an advance lowers the party's balance, ADR-007 §9); then the order, confirmed; its delivery from one place,
// posted; its invoice, shipped to the shop, posted; and every receipt applied to that invoice. Any refusal on the way
// rolls all of it back.
import { deliveryLines, priceListVersions, quickBillHolds, salesOrderLines, salesOrders, salesTx } from '@radcore/db/sales';
import {
  addParty, allocatePayment, companyForInvoice, getCompanyProfile, holdParty, holdPeriod, JOURNAL_SERIES, moneyAccountRefusal, partyWithPhone, RECEIPT_SERIES,
  recordCounterReceipt, systemAccountId, systemPartyId,
} from '@radcore/lib-accounts';
import { dec, looksLikeCardNumber, roundMoney, sum, type Money } from '@radcore/lib-common';
import { AppError, defineSetting, holdSeries, principalId, versionHash, type Ctx } from '@radcore/lib-platform';
import { holdStock } from '@radcore/lib-stock';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { completeQuickBill, createQuickBill, holdQuickBill, previewQuickBill } from '../contract.ts';
import type { ApprovedThrough } from './checks.ts';
import { addDelivery, DELIVERY_SERIES, postDeliveryNow, postDeliveryThrough } from './deliveries.ts';
import { B2C_DETAILS_BASIS, B2C_DETAILS_LIMIT, INVOICE_SERIES, postInvoiceNow, postInvoiceThrough } from './invoice-post.ts';
import { needsBuyerDetails } from './invoice-rules.ts';
import { addInvoice } from './invoices.ts';
import { amountsOf } from './document-amounts.ts';
import { checkedLines, sellingTo } from './document-lines.ts';
import { heldExposure, orderCheckNow, orderIssues, orderOverride } from './order-checks.ts';
import { addCounterOrder, askOrderOverride, confirmOrderNow, getOrderById, ORDER_SERIES, priced } from './orders.ts';
import { holdOf, type PlannedPayment } from './quick-bill-holds.ts';

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

type Receipt = { id: string; number: string; amount: Money };
type Lines = In<typeof createQuickBill>['lines'];

/** Refuses a principal without every stage's key, naming them all, before anything is written (the architect). */
function needKeys(ctx: Ctx): void {
  const missing = KEYS.filter((k) => !ctx.can(k));
  if (missing.length > 0) throw new AppError('forbidden', `A quick bill needs ${missing.join(', ')}`);
}

/** The receipts, taken first. The quick bill's go through lib-accounts under its own keys, not payments:write, as a
 * booking's advance does (the architect on RAD-115): receipts only, never a payment out or a refund; at most the bill
 * (`overpaid`, in settle); each applied to this bill's invoice before the save ends; and cash still within the day's
 * limit. */
async function takeReceipts(ctx: Ctx, partyId: string, businessDate: string, taken: Awaited<ReturnType<typeof receiptsOf>>): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  for (const r of taken) {
    const made = await recordCounterReceipt(ctx, { partyId, businessDate, amount: r.amount, accountId: r.accountId,
      narration: 'Quick bill', ...(r.reference === undefined ? {} : { reference: r.reference }) });
    if (made.status !== 'posted' || made.number === null) {
      throw new AppError('cash_over_limit', 'That’s more cash than may be taken from one person in a day (section 269ST): take the rest by UPI, card or bank',
        [{ path: ['payments'], code: 'cash_over_limit', message: 'Take less in cash' }]);
    }
    receipts.push({ id: made.id, number: made.number, amount: r.amount });
  }
  return receipts;
}

/** The Counter customer never carries credit (the architect on RAD-115): credit means a named party, so a walk-in bill
 * is paid in full, judged on the order's total, rounded to the rupee as its invoice's will be, before any check runs. A
 * total that can't be worked out yet (a missing GST rate) is confirming's to refuse, by name. */
async function walkInPaysInFull(ctx: Ctx, partyId: string, orderId: string, paid: readonly { amount: string }[]): Promise<void> {
  if (partyId !== await systemPartyId(ctx, 'walk_in')) return;
  const { total } = (await getOrderById(ctx, { id: orderId })).amounts;
  if (total !== null && dec(sum(paid.map((p) => p.amount))).lt(total)) {
    throw new AppError('walk_in_pays_in_full', `The Counter customer pays the whole bill of ${total}: to leave a balance, add the buyer’s name and phone`,
      [{ path: ['payments'], code: 'walk_in_pays_in_full', message: `Take ${total} in all, or add the buyer’s name and phone` }]);
  }
}

/** The confirmed order's whole delivery from the place, posted, and its invoice of exactly that delivery, shipped to the
 * shop, posted: through the order's approval when completing a held bill (`through`). */
async function deliverAndBill(ctx: Ctx, s: { orderId: string; partyId: string; businessDate: string; locationId: string; lines: Lines },
  through?: ApprovedThrough) {
  const tx = salesTx(ctx);
  const orderLines = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.orderId, s.orderId))
    .orderBy(asc(salesOrderLines.lineNo));
  const delivery = await addDelivery(ctx, { orderId: s.orderId, locationId: s.locationId, businessDate: s.businessDate, notes: null,
    lines: s.lines.map((l, i) => ({ orderLineId: orderLines[i]?.id ?? '', qty: l.qty, batches: l.batches, serials: l.serials })) });
  const delivered = through === undefined ? await postDeliveryNow(ctx, delivery) : await postDeliveryThrough(ctx, delivery.id, through);
  const billed = await tx.select({ id: deliveryLines.id }).from(deliveryLines)
    .where(eq(deliveryLines.deliveryId, delivery.id)).orderBy(asc(deliveryLines.lineNo));
  // Shipped to the shop: the goods are handed over at the counter, so its tax is the counter's, whoever buys (the
  // architect on RAD-115; CA-08's default until the CA answers).
  const shop = await companyForInvoice(ctx);
  const invoice = await addInvoice(ctx, { partyId: s.partyId, businessDate: s.businessDate, notes: null, shipTo: { name: shop.legalName,
    address: [shop.addressLine1, shop.addressLine2, shop.city, shop.pincode].filter((x) => x !== null && x !== '').join(', '),
    stateCode: shop.stateCode }, lines: s.lines.map((l, i) => ({ deliveryLineId: billed[i]?.id ?? '', qty: l.qty })) });
  const posted = through === undefined ? await postInvoiceNow(ctx, invoice)
    : await postInvoiceThrough(ctx, invoice.id, { ...through, deliveryId: delivery.id });
  return { delivery: { id: delivery.id, number: delivered.number }, invoice: { id: invoice.id, number: posted.number }, total: posted.total };
}

/** At most the bill, and every receipt applied to this bill's invoice, so the quick bill leaves no advance standing; and a
 * walk-in's bill paid in full on the invoice's own total, which is what's owed (auditor-2 on #304). */
async function settle(ctx: Ctx, receipts: readonly Receipt[], s: { partyId: string; invoiceId: string; total: string; businessDate: string }) {
  const { invoiceId, total, businessDate } = s;
  const paid = roundMoney(sum(receipts.map((r) => r.amount)));
  if (s.partyId === await systemPartyId(ctx, 'walk_in') && dec(paid).lt(total)) {
    throw new AppError('walk_in_pays_in_full', `The Counter customer pays the whole bill of ${total}: to leave a balance, add the buyer’s name and phone`,
      [{ path: ['payments'], code: 'walk_in_pays_in_full', message: `Take ${total} in all, or add the buyer’s name and phone` }]);
  }
  if (dec(paid).gt(total)) {
    throw new AppError('overpaid', `That’s more than the bill of ${total}`, [{ path: ['payments'], code: 'overpaid', message: 'Pay at most the bill' }]);
  }
  for (const r of receipts) {
    await allocatePayment(ctx, { id: r.id, businessDate, lines: [{ documentTable: 'invoices', documentId: invoiceId, amount: r.amount }] });
  }
  return { receipts: receipts.map(({ id, number }) => ({ id, number })), paid, left: roundMoney(dec(total).minus(paid)) };
}

const orderLinesOf = (lines: Lines) => lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discountPercent: l.discountPercent }));

/**
 * ADR-006 §1 for a save that posts several documents (the architect on RAD-115): before the first posts, every class of
 * lock for all of them, in §1's order. That's the period, then the caller's documents (a held bill's order and hold), the
 * party, the stock positions and units of every line, and then every series it draws, in seriesOrder. So it never holds
 * one while waiting on a plain receipt, delivery or invoice that holds the next; each posting re-takes them for free.
 */
async function holdBill(ctx: Ctx, partyId: string, businessDate: string, locationId: string,
  lines: readonly { itemId: string; serials: readonly string[] }[]): Promise<void> {
  await holdPeriod(ctx, businessDate);
  await holdParty(ctx, partyId);
  await holdStock(ctx, lines.map((l) => ({ itemId: l.itemId, locationId, serials: l.serials })));
  await holdSeries(ctx, [JOURNAL_SERIES, RECEIPT_SERIES, ORDER_SERIES, DELIVERY_SERIES, INVOICE_SERIES]);
}

/** POST /sales/quick-bills (invoices:write, and the stages' keys): the counter sale, whole. */
export async function quickBill(ctx: Ctx, input: In<typeof createQuickBill>): Promise<Out<typeof createQuickBill>> {
  needKeys(ctx);
  const partyId = input.partyId ?? await systemPartyId(ctx, 'walk_in');
  const { businessDate } = input;
  await holdBill(ctx, partyId, businessDate, input.locationId, input.lines);
  const receipts = await takeReceipts(ctx, partyId, businessDate, await receiptsOf(ctx, input.payments));
  const order = await addCounterOrder(ctx, { partyId, businessDate, notes: input.notes, lines: orderLinesOf(input.lines) });
  await walkInPaysInFull(ctx, partyId, order.id, receipts);
  const confirmed = await confirmOrderNow(ctx, order).catch((e: unknown) => {
    // The order check's refusal in the counter's words: a quick bill is held for its approval, never an order confirmed
    // later (e2e-playwright on #325).
    if (e instanceof AppError && e.code === 'needs_override') throw new AppError('needs_override', 'This bill needs someone else’s approval for an override; hold it to ask for one', e.issues);
    throw e;
  });
  const b = await deliverAndBill(ctx, { orderId: order.id, partyId, businessDate, locationId: input.locationId, lines: input.lines });
  return { order: { id: order.id, number: confirmed.number }, delivery: b.delivery, invoice: b.invoice, total: b.total,
    ...await settle(ctx, receipts, { partyId, invoiceId: b.invoice.id, total: b.total, businessDate }) };
}

/**
 * POST /sales/quick-bills/hold (invoices:write, and the stages' keys): a bill that needs an approval (a discount, a
 * price below cost, credit), held for it (Sarthak: "Hold, then complete"). Its order is saved a draft, with the place,
 * the picks and the payments planned (method and amount: no card is charged yet), and its override is asked for,
 * judged as completing it will be, with the planned payments taken first (`paidNow`).
 */
export async function holdBillNow(ctx: Ctx, input: In<typeof holdQuickBill>): Promise<Out<typeof holdQuickBill>> {
  needKeys(ctx);
  // The plan is checked before anything is written (auditor-2 on #318): it's kept for good once held, in the hold's row
  // and its audit trail, so a card number can't be stored in a reference, and an account that can't take money isn't
  // approved only to be refused at complete.
  for (const [n, p] of input.payments.entries()) {
    if (!dec(p.amount).gt(0)) {
      throw new AppError('no_payment_amount', 'Each payment is more than 0', [{ path: ['payments', n, 'amount'], code: 'no_payment_amount',
        message: 'Type what will be paid, or remove the payment' }]);
    }
    if (p.method !== 'bank') continue;
    if (p.reference !== undefined && looksLikeCardNumber(p.reference)) {
      throw new AppError('looks_like_card_number', 'That looks like a card number: a reference is a UTR or cheque number, never card digits',
        [{ path: ['payments', n, 'reference'], code: 'looks_like_card_number', message: 'Type the UTR or cheque number' }]);
    }
    const refused = await moneyAccountRefusal(ctx, p.accountId);
    if (refused !== null) {
      throw new AppError('not_money_account', refused, [{ path: ['payments', n, 'accountId'], code: 'not_money_account', message: 'Choose Cash or a bank account' }]);
    }
  }
  const partyId = input.buyer === undefined ? input.partyId ?? await systemPartyId(ctx, 'walk_in') : await buyerParty(ctx, input);
  // A card's approval code comes when it's charged, at complete; any given now is dropped.
  const planned: PlannedPayment[] = input.payments.map((p) => p.method === 'bank'
    ? { method: 'bank', amount: p.amount, accountId: p.accountId, ...(p.reference === undefined ? {} : { reference: p.reference }) }
    : { method: p.method, amount: p.amount });
  const order = await addCounterOrder(ctx, { partyId, businessDate: input.businessDate, notes: input.notes, lines: orderLinesOf(input.lines) });
  await walkInPaysInFull(ctx, partyId, order.id, planned);
  if (input.buyer !== undefined) await buyerDetailsFor(ctx, input.buyer, order.id);
  await salesTx(ctx).insert(quickBillHolds).values({ orderId: order.id, locationId: input.locationId, payments: planned,
    picks: input.lines.map((l, i) => ({ lineNo: i + 1, batches: l.batches, serials: l.serials })) });
  const version = await orderOverride.version(ctx, order.id, { forUpdate: false });
  if (version === null || version.issues.length === 0) {
    throw new AppError('no_override_needed', 'This bill needs no approval: save it as a quick bill');
  }
  const asked = await askOrderOverride(ctx, order);
  return { status: 'pending_override', orderId: order.id, approvalId: asked.id, versionHash: asked.versionHash };
}

/**
 * A walk-in who leaves a balance, named (the architect's re-ruling on Sarthak's "Allow with approval"): asked for under
 * sales:counter_credit, made under parties:write. The party with that phone is offered rather than made again; else a new
 * customer, unregistered, in the shop's state, with no credit limit, so its unpaid part needs the ordinary approval. It's
 * made in the hold's own transaction, so the approval names a real party.
 */
async function buyerParty(ctx: Ctx, input: In<typeof holdQuickBill>): Promise<string> {
  const b = input.buyer;
  if (b === undefined) throw new Error('buyerParty without a buyer');
  if (input.partyId !== undefined) {
    throw new AppError('buyer_for_walk_in_only', 'A named party is billed as itself: give a buyer only for a walk-in',
      [{ path: ['buyer'], code: 'buyer_for_walk_in_only', message: 'Remove the buyer, or the party' }]);
  }
  const missing = ['sales:counter_credit', 'parties:write'].filter((k) => !ctx.can(k));
  if (missing.length > 0) throw new AppError('forbidden', `Leaving a balance on a counter sale needs ${missing.join(', ')}`);
  // It can't check for a duplicate by a phone it may not see (the architect on #318).
  if (!ctx.shows('whole', 'parties:contact')) throw new AppError('forbidden', 'Naming a buyer at the counter needs parties:contact');
  if (await partyWithPhone(ctx, b.phone) !== null) {
    throw new AppError('buyer_has_party', 'A customer with this phone exists already: choose them, so their own limit and history apply',
      [{ path: ['buyer', 'phone'], code: 'buyer_has_party', message: 'Choose the customer with this phone' }]);
  }
  const shop = await companyForInvoice(ctx);
  const { id } = await addParty(ctx, { name: b.name, kinds: ['customer'], gstin: null, pan: null, composition: false, stateCode: shop.stateCode,
    phone: b.phone, email: null, addressLine1: b.addressLine1 ?? null, addressLine2: null, city: b.city ?? null, pincode: b.pincode ?? null });
  return id;
}

/** At or above sales.b2c_details_limit an unregistered buyer is named with their address (Rule 46): asked for at the
 * hold, not left to the invoice's posting. */
async function buyerDetailsFor(ctx: Ctx, b: NonNullable<In<typeof holdQuickBill>['buyer']>, orderId: string): Promise<void> {
  const { amounts } = await getOrderById(ctx, { id: orderId });
  if (amounts.total === null) return;
  const big = needsBuyerDetails({ total: amounts.total, taxable: amounts.taxable }, ctx.settings.get(B2C_DETAILS_LIMIT), ctx.settings.get(B2C_DETAILS_BASIS));
  if (big && (b.addressLine1 === undefined || b.city === undefined || b.pincode === undefined)) {
    throw new AppError('buyer_details_required', 'A bill this size names its buyer: add their address, city and PIN code',
      [{ path: ['buyer'], code: 'buyer_details_required', message: 'Add the address, city and PIN code' }]);
  }
}

/**
 * POST /sales/quick-bills/:orderId/complete (invoices:write at the order's scope, and the stages' keys): a held bill
 * whose override was approved, sold as held: the planned payments taken first, as receipts (each card with its approval
 * code now), then the order confirmed on its approval, its whole delivery and its invoice through that approval (the
 * architect on RAD-115). The hold is gone after, so a second complete is `not_held`.
 */
export async function completeBillNow(ctx: Ctx, input: In<typeof completeQuickBill>): Promise<Out<typeof completeQuickBill>> {
  needKeys(ctx);
  const { businessDate } = input;
  // ADR-006 §1: the period first, then the order, locked, in the documents step; its hold with it.
  await holdPeriod(ctx, businessDate);
  const [order] = await salesTx(ctx).select({ partyId: salesOrders.partyId, businessDate: salesOrders.businessDate, status: salesOrders.status,
    createdBy: salesOrders.createdBy, approved: salesOrders.overrideVersion }).from(salesOrders).where(eq(salesOrders.id, input.orderId))
    .for('update');
  if (order === undefined) throw new AppError('not_found', 'There is no such order');
  ctx.see('invoices:write', { owner: order.createdBy });
  const hold = await holdOf(ctx, input.orderId, true);
  if (hold === null || order.status !== 'draft') throw new AppError('not_held', 'This order isn’t a quick bill held for approval');
  if (order.approved === null) throw new AppError('needs_override', 'This held bill’s override isn’t approved yet');
  // After the order and its hold, the rest of §1's locks for the whole bill, before its balance is judged.
  const picked = new Map(hold.picks.map((p) => [p.lineNo, p.serials]));
  const items = await salesTx(ctx).select({ itemId: salesOrderLines.itemId, lineNo: salesOrderLines.lineNo }).from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, input.orderId));
  await holdBill(ctx, order.partyId, businessDate, hold.locationId, items.map((l) => ({ itemId: l.itemId, serials: picked.get(l.lineNo) ?? [] })));
  // The approval holds only for what was owed when it was given: a balance grown since is asked again (the architect).
  const owed = await heldExposure(ctx, input.orderId);
  if (hold.approvedAfter !== null && owed !== null && dec(owed).gt(hold.approvedAfter)) {
    throw new AppError('version_changed', 'The party owes more than when this bill was approved: ask for its approval again');
  }
  // The amounts are the hold's, never new ones; each card payment takes its code, in order (Q4's rules).
  let card = 0;
  const payments: Payment[] = hold.payments.map((p) => p.method === 'card'
    ? { method: 'card', amount: p.amount as Payment['amount'], ...(input.approvalCodes[card] === undefined ? {} : { approvalCode: input.approvalCodes[card++] }) }
    : p.method === 'bank' ? { method: 'bank', amount: p.amount as Payment['amount'], accountId: p.accountId ?? '', ...(p.reference === undefined ? {} : { reference: p.reference }) }
      : { method: 'cash', amount: p.amount as Payment['amount'] });
  // Every check that writes nothing first, the card codes too; then the hold goes, and the receipts are taken.
  const taken = await receiptsOf(ctx, payments);
  await salesTx(ctx).delete(quickBillHolds).where(eq(quickBillHolds.orderId, input.orderId));
  const receipts = await takeReceipts(ctx, order.partyId, businessDate, taken);
  // With the receipts taken, the bill is judged as its override was (paidNow at hold): approved on a balance that has
  // moved since, it's refused by name, to ask again (the architect on RAD-115).
  const version = await orderOverride.version(ctx, input.orderId, { forUpdate: false });
  if (version !== null && version.issues.length > 0 && versionHash(version) !== order.approved) {
    throw new AppError('version_changed', 'The party’s balance has changed since this bill was approved: ask for its approval again');
  }
  // What the approval covers, read as confirming will judge it, with the receipts taken: its kinds, and what's owed.
  const now = await orderCheckNow(ctx, input.orderId, order);
  const through: ApprovedThrough = { orderId: input.orderId, kinds: now.issues.map((i) => i.code), after: now.credit.after };
  const confirmed = await confirmOrderNow(ctx, { id: input.orderId });
  const picks = new Map(hold.picks.map((p) => [p.lineNo, p]));
  const lines = (await getOrderById(ctx, { id: input.orderId })).lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate,
    discountPercent: l.discountPercent, batches: picks.get(l.lineNo)?.batches ?? [], serials: picks.get(l.lineNo)?.serials ?? [] })) as Lines;
  const b = await deliverAndBill(ctx, { orderId: input.orderId, partyId: order.partyId, businessDate, locationId: hold.locationId, lines }, through);
  return { order: { id: input.orderId, number: confirmed.number }, delivery: b.delivery, invoice: b.invoice, total: b.total,
    ...await settle(ctx, receipts, { partyId: order.partyId, invoiceId: b.invoice.id, total: b.total, businessDate }) };
}

/**
 * POST /sales/quick-bills/preview (invoices:write): what the bill would come to, before it's saved (the architect on
 * RAD-115). Its lines priced as the save prices them (the party's list), taxed by lib-gst at the shop, as the save's
 * invoice is shipped there, and rounded as an invoice is (totalsOf), so this total is the posted one; what the payments
 * leave; and the codes of the checks confirming it would raise, judged with the payments taken. Read only: no number,
 * no lock, no write, no approval asked, no party made; and no cost or balance answered, only the codes.
 */
export async function previewBill(ctx: Ctx, input: In<typeof previewQuickBill>): Promise<Out<typeof previewQuickBill>> {
  const partyId = input.partyId ?? await systemPartyId(ctx, 'walk_in');
  await sellingTo(ctx, partyId);
  const checked = await checkedLines(ctx, input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discountPercent: l.discountPercent })));
  const { lines } = await priced(ctx, partyId, input.businessDate, checked);
  // Shipped to the shop, as the save's invoice is: its state, read without a lock (the save's posting takes one).
  const { company } = await getCompanyProfile(ctx);
  const a = await amountsOf(ctx, partyId, input.businessDate, lines, company?.stateCode);
  const paid = roundMoney(sum(input.payments.map((p) => p.amount)));
  const versionIds = [...new Set(lines.flatMap((l) => (l.listVersionId === null ? [] : [l.listVersionId])))];
  const inclusive = new Map(versionIds.length === 0 ? [] : (await salesTx(ctx).select({ id: priceListVersions.id, taxInclusive: priceListVersions.taxInclusive })
    .from(priceListVersions).where(inArray(priceListVersions.id, versionIds))).map((v) => [v.id, v.taxInclusive]));
  const found = await orderIssues(ctx, { partyId, businessDate: input.businessDate, createdBy: principalId(ctx.principal) },
    lines.map((l) => ({ ...l, listTaxInclusive: l.listVersionId === null ? null : inclusive.get(l.listVersionId) ?? null })), paid);
  // The Counter customer never carries credit, so a short walk-in is asked for the rest, or for the buyer, as the save and
  // the hold refuse it, never told it's over a limit no approval can lift (auditor-2 on #325).
  const short = partyId === await systemPartyId(ctx, 'walk_in') && dec(paid).lt(a.totals.total);
  const issues = short ? ['walk_in_pays_in_full', ...found.filter((c) => c !== 'over_limit' && c !== 'overdue')] : found;
  return { lines: a.lines.map((l, i) => ({ itemId: lines[i]?.itemId ?? '', gstRate: l.gstRate, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst,
    igst: l.igst, lineTotal: l.lineTotal })), placeOfSupply: a.placeOfSupply, taxable: a.totals.taxable, cgst: a.totals.cgst, sgst: a.totals.sgst,
    igst: a.totals.igst, roundOff: a.totals.roundOff, total: a.totals.total, paid, left: roundMoney(dec(a.totals.total).minus(paid)), issues };
}
