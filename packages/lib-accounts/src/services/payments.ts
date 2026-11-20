// Receipts, payments and refunds (M3-12, RAD-116; ADR-007 §1–§5, §8; ADR-006 §6, F8). Each is saved as a draft and
// posted in the same save, through the journal engine, then numbered last (ADR-006 §1): RV for a receipt, PV for a
// payment or refund. Cash past a day's limit (RC-114, CA-24) stays a draft and asks an owner, through defineApproval;
// the approval posts it. A posted one is cancelled only by a mirror entry dated the cancellation's day (ADR-007 §6).
// shortcut: allocations to invoices and bills, and the rule that a cancel needs them at zero, are RAD-116's part 2.
import { accounts, accountsTx, parties, payments } from '@radcore/db/accounts';
import { dec, indiaDate, moneyString, roundMoney, sum, type Money } from '@radcore/lib-common';
import { AppError, defineSeries, defineSetting, nextNumber, principalId, requestApproval, type ApprovalSpec, type Ctx }
  from '@radcore/lib-platform';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelPaymentContract, recordPaymentContract } from '../contract.ts';
import { holdPeriod, postEntry, reverseEntry, type JournalLine } from './journal.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

export const RECEIPT_SERIES = defineSeries('accounts.receipt', 'RV');
export const PAYMENT_SERIES = defineSeries('accounts.payment', 'PV');
/** Section 269ST: a party's cash receipts in a day at or past this ask an owner (CA-24 to confirm). */
export const CASH_RECEIPT_LIMIT = defineSetting('accounts.cash_receipt_limit', moneyString(), roundMoney('200000'));
/** Section 40A(3): a party's cash payments in a day past this ask an owner (CA-24 to confirm). */
export const CASH_PAYMENT_LIMIT = defineSetting('accounts.cash_payment_limit', moneyString(), roundMoney('10000'));

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
const today = () => indiaDate(new Date());

/** The money account a payment moves: Cash, Bank, or a bank account under Bank. */
async function moneyAccount(ctx: Ctx, id: string): Promise<{ cash: boolean }> {
  const tx = accountsTx(ctx);
  const [a] = await tx.select({ key: accounts.systemKey, parentId: accounts.parentId, active: accounts.active }).from(accounts)
    .where(eq(accounts.id, id)).limit(1);
  if (a === undefined) return refuse('unknown_account', 'There’s no such account');
  // The engine would refuse it too (RA009); said here by name, before anything is written (the auditor on #234).
  if (!a.active) refuse('account_inactive', 'This account is switched off: switch it on, or use another');
  if (a.key === 'cash' || a.key === 'bank') return { cash: a.key === 'cash' };
  const [parent] = a.parentId === null ? [] : await tx.select({ key: accounts.systemKey }).from(accounts).where(eq(accounts.id, a.parentId)).limit(1);
  return parent?.key === 'bank' ? { cash: false } : refuse('not_money_account', 'Take or pay money through Cash or a bank account');
}

/** The lines a payment posts (ADR-006 §6): its party's Debtors or Creditors line carries the whole amount, gross of TDS. */
function linesOf(p: { kind: string; partyId: string; amount: Money; tds: Money; accountId: string }): JournalLine[] {
  const net = roundMoney(dec(p.amount).minus(p.tds));
  const held = dec(p.tds).gt(0);
  if (p.kind === 'receipt') {
    return [{ account: { id: p.accountId }, debit: net }, ...(held ? [{ account: { system: 'tds_receivable' }, debit: p.tds }] : []),
      { account: { system: 'debtors' }, partyId: p.partyId, credit: p.amount }];
  }
  if (p.kind === 'payment') {
    return [{ account: { system: 'creditors' }, partyId: p.partyId, debit: p.amount }, { account: { id: p.accountId }, credit: net },
      ...(held ? [{ account: { system: 'tds_payable' }, credit: p.tds }] : [])];
  }
  return [{ account: { system: 'debtors' }, partyId: p.partyId, debit: p.amount }, { account: { id: p.accountId }, credit: p.amount }];
}

/** A refund's checks, against its receipt's row, locked: the receipt still posted, the same party, not dated before it,
 * and its posted refunds with this one within its amount. Run when it's recorded and again when it posts, so a refund
 * that waited for approval can't post past the cap, or after its receipt was cancelled (the architect on #234). */
async function checkRefund(ctx: Ctx, r: Readonly<{ receiptId: string; partyId: string; businessDate: string; amount: Money }>) {
  const tx = accountsTx(ctx);
  const [receipt] = await tx.select().from(payments).where(and(eq(payments.id, r.receiptId), eq(payments.kind, 'receipt'))).limit(1)
    .for('update');
  if (receipt?.status !== 'posted') return refuse('receipt_not_posted', 'The receipt isn’t posted');
  if (receipt.partyId !== r.partyId) refuse('refund_other_party', 'A refund goes back to the party who paid');
  if (r.businessDate < receipt.businessDate) refuse('date_before_source', 'A refund is dated on or after its receipt');
  const refunded = await tx.select({ amount: payments.amount }).from(payments)
    .where(and(eq(payments.refundOfId, receipt.id), eq(payments.status, 'posted')));
  if (sum([...refunded.map((x) => x.amount), r.amount]).gt(receipt.amount)) refuse('exceeds_receipt', 'That’s more than is left of the receipt');
}

/** Posts a draft: its entry through the journal engine, then its number, last. A refund is checked against its receipt
 * again here, under the receipt's lock, whatever path posts it. */
async function post(ctx: Ctx, id: string): Promise<{ number: string }> {
  const tx = accountsTx(ctx);
  // The period lock first, then the payment's row (ADR-006 §1). An approval's version() has already locked the row,
  // as the engine reads it before deciding; that path takes the period lock second (the auditor on #234).
  const [dated] = await tx.select({ businessDate: payments.businessDate }).from(payments).where(eq(payments.id, id)).limit(1);
  if (dated !== undefined) await holdPeriod(ctx, dated.businessDate);
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, id), eq(payments.status, 'draft'))).limit(1).for('update');
  if (p === undefined) return refuse('not_draft', 'This is already posted or cancelled');
  if (p.refundOfId !== null) {
    await checkRefund(ctx, { receiptId: p.refundOfId, partyId: p.partyId, businessDate: p.businessDate, amount: roundMoney(p.amount) });
  }
  const entry = await postEntry(ctx, { kind: p.kind === 'receipt' ? 'payment_in' : 'payment_out', businessDate: p.businessDate,
    source: { table: 'payments', id }, lines: linesOf({ ...p, amount: roundMoney(p.amount), tds: roundMoney(p.tds) }) });
  const number = await nextNumber(ctx, p.kind === 'receipt' ? RECEIPT_SERIES : PAYMENT_SERIES, p.businessDate);
  await tx.update(payments).set({ status: 'posted', number, postedEntryId: entry.id }).where(eq(payments.id, id));
  return { number };
}

/** Whether this cash, with the party's other posted cash that day, passes the day's limit (ADR-007 §8). */
async function pastCashLimit(ctx: Ctx, p: { id: string; kind: string; partyId: string; businessDate: string; amount: Money }) {
  const out = p.kind !== 'receipt';
  // The party's row, locked, so two cash saves for one party take turns and neither sums without the other.
  await accountsTx(ctx).select({ id: parties.id }).from(parties).where(eq(parties.id, p.partyId)).limit(1).for('update');
  const cash = accountsTx(ctx).select({ id: accounts.id }).from(accounts).where(eq(accounts.systemKey, 'cash'));
  const earlier = await accountsTx(ctx).select({ amount: payments.amount }).from(payments).where(and(eq(payments.partyId, p.partyId),
    eq(payments.businessDate, p.businessDate), eq(payments.status, 'posted'), inArray(payments.accountId, cash), ne(payments.id, p.id),
    out ? inArray(payments.kind, ['payment', 'refund']) : eq(payments.kind, 'receipt')));
  const total = sum([...earlier.map((e) => e.amount), p.amount]);
  return out ? total.gt(ctx.settings.get(CASH_PAYMENT_LIMIT)) : total.gte(ctx.settings.get(CASH_RECEIPT_LIMIT));
}

/** What an owner approves for cash past the limit: the payment's own figures, the row locked while it's checked. The
 * figures, whatever the status: posting changes the status, never what was approved (ADR-001 §8b), and post() refuses
 * a payment that isn't a draft. */
export const cashLimitSpec: ApprovalSpec<{ kind: string; partyId: string; businessDate: string; amount: string; accountId: string }> = {
  kind: 'cash-limit',
  table: 'payments',
  async version(ctx, id, { forUpdate }) {
    const q = accountsTx(ctx).select({ kind: payments.kind, partyId: payments.partyId, businessDate: payments.businessDate,
      amount: payments.amount, accountId: payments.accountId }).from(payments).where(eq(payments.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    return row === undefined ? null : { ...row, amount: roundMoney(row.amount) };
  },
  async approved(ctx, id) {
    await post(ctx, id);
  },
  // A refused one stays a draft, unposted: its maker changes it or lets it be.
  async rejected() {},
};

/** POST /payments: a receipt, payment or refund, posted now, or held as a draft for an owner past the cash limit. */
export async function recordPayment(ctx: Ctx, input: In<typeof recordPaymentContract>): Promise<Out<typeof recordPaymentContract>> {
  const tx = accountsTx(ctx);
  // TDS held back is optional: none when it's left out.
  const p = { ...input, tds: input.tds ?? roundMoney('0') };
  if (!dec(p.tds).lt(p.amount)) refuse('invalid_tds', 'TDS held back is less than the amount');
  if (p.kind === 'refund' && dec(p.tds).gt(0)) refuse('invalid_tds', 'A refund holds no TDS');
  if (p.businessDate > today()) refuse('date_in_future', 'The date is after today');
  // The period lock FOR SHARE first (ADR-006 §1), with year_not_open and period_locked by name.
  await holdPeriod(ctx, p.businessDate);
  if (p.kind === 'refund') {
    if (p.refundOf === undefined) return refuse('refund_needs_receipt', 'Say which receipt this refund pays back');
    await checkRefund(ctx, { receiptId: p.refundOf, partyId: p.partyId, businessDate: p.businessDate, amount: p.amount });
  } else if (p.refundOf !== undefined) {
    refuse('refund_needs_receipt', 'Only a refund names a receipt');
  }
  const { cash } = await moneyAccount(ctx, p.accountId);
  const [row] = await tx.insert(payments).values({ kind: p.kind, partyId: p.partyId, businessDate: p.businessDate, amount: p.amount, tds: p.tds,
    accountId: p.accountId, refundOfId: p.refundOf ?? null, narration: p.narration ?? null }).returning({ id: payments.id });
  const id = row?.id ?? refuse('server_error', 'The payment was not stored');
  if (cash && await pastCashLimit(ctx, { id, ...p })) {
    await requestApproval(ctx, cashLimitSpec, id);
    return { id, status: 'pending_approval', number: null };
  }
  return { id, status: 'posted', ...(await post(ctx, id)) };
}

/** POST /payments/:id/cancel: a mirror entry dated the cancellation's day, and the payment cancelled with its reason. */
export async function cancelPayment(ctx: Ctx, c: In<typeof cancelPaymentContract>): Promise<Out<typeof cancelPaymentContract>> {
  const tx = accountsTx(ctx);
  if (c.businessDate > today()) refuse('date_in_future', 'The date is after today');
  // The period lock first, then the payment's row (ADR-006 §1, the auditor on #234).
  await holdPeriod(ctx, c.businessDate);
  const [p] = await tx.select().from(payments).where(eq(payments.id, c.id)).limit(1).for('update');
  if (p === undefined) return refuse('not_found', 'There’s no such payment');
  if (p.status !== 'posted' || p.postedEntryId === null) return refuse('not_posted', 'Only a posted payment is cancelled');
  if (c.businessDate < p.businessDate) refuse('date_before_source', 'A cancellation is dated on or after what it cancels');
  const [refund] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.refundOfId, p.id), eq(payments.status, 'posted'))).limit(1);
  if (refund !== undefined) refuse('has_refunds', 'Cancel the refunds of this receipt first');
  const mirror = await reverseEntry(ctx, { entryId: p.postedEntryId, businessDate: c.businessDate, reason: c.reason });
  await tx.update(payments).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal), cancelReason: c.reason,
    cancelEntryId: mirror.id }).where(eq(payments.id, p.id));
  return {};
}
