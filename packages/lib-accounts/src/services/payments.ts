// Receipts, payments and refunds (M3-12, RAD-116; ADR-007 §1–§5, §8; ADR-006 §6, F8). Each is saved as a draft and
// posted in the same save, through the journal engine, then numbered last (ADR-006 §1): RV for a receipt, PV for a
// payment or refund. Cash past a day's limit (RC-114, CA-24) stays a draft and asks an owner, through defineApproval;
// the approval posts it. A posted one is cancelled only by a mirror entry dated the cancellation's day (ADR-007 §6).
import { accounts, accountsTx, parties, payments } from '@radcore/db/accounts';
import { dec, indiaDate, moneyString, roundMoney, sum, type Money } from '@radcore/lib-common';
import { AppError, awaitingApproval, defineSeries, defineSetting, nextNumber, principalId, requestApproval, type ApprovalSpec, type Ctx }
  from '@radcore/lib-platform';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelPaymentContract, recordPaymentContract } from '../contract.ts';
import { paymentUsed } from './allocations.ts';
import { holdPeriod, lockPeriod, postEntry, reverseEntry, type JournalLine } from './journal.ts';
import { holdParty } from './parties.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

export const RECEIPT_SERIES = defineSeries('accounts.receipt', 'RV', { label: 'Receipts' });
export const PAYMENT_SERIES = defineSeries('accounts.payment', 'PV', { label: 'Payments and refunds' });
/** Section 269ST: a party's cash receipts in a day at or past this ask an owner (CA-24 to confirm). */
export const CASH_RECEIPT_LIMIT = defineSetting('accounts.cash_receipt_limit', moneyString(), roundMoney('200000'), {
  label: 'Cash received from a party in a day',
  description: 'A party’s cash receipts in a day at or past this wait for an owner’s approval (section 269ST).',
  input: { kind: 'money' },
});
/** Section 40A(3): a party's cash payments in a day past this ask an owner (CA-24 to confirm). */
export const CASH_PAYMENT_LIMIT = defineSetting('accounts.cash_payment_limit', moneyString(), roundMoney('10000'), {
  label: 'Cash paid to a party in a day',
  description: 'A party’s cash payments and refunds in a day past this wait for an owner’s approval (section 40A(3)).',
  input: { kind: 'money' },
});
/** The days a bill may stay unpaid for a party with no credit days of its own (Sarthak: "keep it dynamic"; the
 * architect on RAD-111): 0 by default, so its bills are due the day they're made. The sale checks read it (M3-07), and
 * M3-15 will. */
export const DEFAULT_CREDIT_DAYS = defineSetting('accounts.default_credit_days', z.number().int().min(0).max(365), 0, {
  label: 'Credit days',
  description: 'The days a party with no credit days of its own has to pay a bill. 0 means bills are due the day they’re made.',
  input: { kind: 'integer' },
});

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

/** Why an account can't take or pay money (not Cash, Bank or under Bank, or switched off), or null when it can: for a
 * setting that names one (lib-sales' sales.card_account, RAD-115). */
export async function moneyAccountRefusal(ctx: Ctx, id: string): Promise<string | null> {
  return moneyAccount(ctx, id).then(() => null, (e: unknown) => {
    if (e instanceof AppError) return e.message;
    throw e;
  });
}

/** A seeded account's id, by its system key (ADR-006 §2): `cash`, `card_settlements` (RAD-115). */
export async function systemAccountId(ctx: Ctx, key: string): Promise<string> {
  const [a] = await accountsTx(ctx).select({ id: accounts.id }).from(accounts).where(eq(accounts.systemKey, key)).limit(1);
  if (a === undefined) throw new Error(`the system account ${key} isn't seeded`);
  return a.id;
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

/** The document a receipt is held for (a booking's advance, RAD-117), named as an allocation names one. */
export type HeldFor = Readonly<{ table: string; id: string }>;
const heldKey = (h: HeldFor | null) => (h === null ? null : `${h.table}:${h.id.toLowerCase()}`);

/** A refund's checks, against its receipt's row, locked: the receipt still posted, the same party, not dated before it,
 * and its posted refunds with this one within its amount. Run when it's recorded and again when it posts, so a refund
 * that waited for approval can't post past the cap, or after its receipt was cancelled (the architect on #234). When
 * recorded, `owner` is who asks: the route (null) refunds only a receipt held for nothing, and a document's service
 * only one held for it. At posting it's left out: a posted receipt's earmark never changes (#185's guard). */
async function checkRefund(ctx: Ctx, r: Readonly<{ receiptId: string; partyId: string; businessDate: string; amount: Money }>,
  owner?: HeldFor | null) {
  const tx = accountsTx(ctx);
  const [receipt] = await tx.select().from(payments).where(and(eq(payments.id, r.receiptId), eq(payments.kind, 'receipt'))).limit(1)
    .for('update');
  if (receipt?.status !== 'posted') return refuse('receipt_not_posted', 'The receipt isn’t posted');
  const held = receipt.heldForTable === null || receipt.heldForId === null ? null : { table: receipt.heldForTable, id: receipt.heldForId };
  if (owner !== undefined && heldKey(held) !== heldKey(owner)) {
    refuse('refund_through_owner', held === null ? 'This receipt isn’t held for that document' : 'This is an advance: refund it through what it’s held for');
  }
  if (receipt.partyId !== r.partyId) refuse('refund_other_party', 'A refund goes back to the party who paid');
  if (r.businessDate < receipt.businessDate) refuse('date_before_source', 'A refund is dated on or after its receipt');
  // What's left of a receipt is its amount less its posted refunds and its net allocations (the architect on #234).
  const { allocated, refunded } = await paymentUsed(ctx, receipt.id);
  if (allocated.plus(refunded).plus(r.amount).gt(receipt.amount)) refuse('exceeds_receipt', 'That’s more than is left of the receipt');
}

/** Posts a draft: its entry through the journal engine, then its number, last. A refund is checked against its receipt
 * again here, under the receipt's lock, whatever path posts it. */
async function post(ctx: Ctx, id: string): Promise<{ number: string }> {
  const tx = accountsTx(ctx);
  // The period lock first, then the payment's row (ADR-006 §1). An approval holds the period already, through
  // cashLimitSpec's lockFirst, before the engine locks the row (the architect on RAD-114); holding it again is free.
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
async function pastCashLimit(ctx: Ctx, p: { id: string; kind: string; partyId: string; businessDate: string; amount: Money }, counter: boolean) {
  const out = p.kind !== 'receipt';
  // ADR-006 §1 step 3: the party, after the payment's own row, so two cash saves for one party take turns and neither
  // sums without the other. NO KEY UPDATE: each one's insert already holds the party's KEY SHARE (the auditor on RAD-116).
  await holdParty(ctx, p.partyId);
  // The Counter customer isn't one person: every walk-in shares it, so a quick bill's cash for it is judged one bill at
  // a time, never by the day (the architect on RAD-115); a quick bill takes its cash as one receipt. Only the quick
  // bill's own receipt is (recordCounterReceipt, auditor-2 on #304): any other sums the day, as for any party.
  const [party] = counter ? await accountsTx(ctx).select({ key: parties.systemKey }).from(parties).where(eq(parties.id, p.partyId)).limit(1) : [];
  const cash = accountsTx(ctx).select({ id: accounts.id }).from(accounts).where(eq(accounts.systemKey, 'cash'));
  const earlier = party?.key === 'walk_in' ? [] : await accountsTx(ctx).select({ amount: payments.amount }).from(payments).where(and(eq(payments.partyId, p.partyId),
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
  // The period's locks first, before the engine locks the payment (the architect on RAD-114), refusing nothing: a
  // reject must go through whatever the period says, and an approval's post() checks the date under the same locks.
  async lockFirst(ctx) {
    await lockPeriod(ctx);
  },
  async approved(ctx, id) {
    await post(ctx, id);
  },
  // A refused one stays a draft, unposted: its maker changes it or lets it be.
  async rejected() {},
};

/** For a document's own service (bookings' key rule, RAD-117; the architect's ruling): what's left of each posted
 * receipt held for `owner`, its amount less its net allocations, its posted refunds and its refunds still waiting for
 * an owner's cash-limit approval. Not a receipt's cap, which checkRefund holds: the booking judges which key a refund
 * needs against this, under its own row's lock, before it calls refundHeld. */
export async function heldLeft(ctx: Ctx, owner: HeldFor): Promise<{ taken: Money; left: Money; receipts: readonly { id: string; left: Money }[] }> {
  const tx = accountsTx(ctx);
  const held = await tx.select({ id: payments.id, amount: payments.amount }).from(payments).where(and(eq(payments.kind, 'receipt'),
    eq(payments.status, 'posted'), eq(payments.heldForTable, owner.table), eq(payments.heldForId, owner.id)));
  const drafts = held.length === 0 ? [] : await tx.select({ id: payments.id, of: payments.refundOfId, amount: payments.amount }).from(payments)
    .where(and(inArray(payments.refundOfId, held.map((h) => h.id)), eq(payments.status, 'draft')));
  const waiting = await awaitingApproval(ctx, cashLimitSpec, drafts.map((d) => d.id));
  const receipts = [];
  for (const h of held) {
    const { allocated, refunded } = await paymentUsed(ctx, h.id);
    const pending = sum(drafts.filter((d) => d.of === h.id && waiting.has(d.id)).map((d) => d.amount));
    receipts.push({ id: h.id, left: roundMoney(dec(h.amount).minus(allocated).minus(refunded).minus(pending)) });
  }
  // `taken`: what the held receipts took in, whatever has since been applied or refunded (a booking's "advance taken").
  return { taken: roundMoney(sum(held.map((h) => h.amount))), left: roundMoney(sum(receipts.map((r) => r.left))), receipts };
}

/** POST /payments: a receipt, payment or refund, posted now, or held as a draft for an owner past the cash limit. */
export function recordPayment(ctx: Ctx, input: In<typeof recordPaymentContract>): Promise<Out<typeof recordPaymentContract>> {
  return record(ctx, input, null, null);
}

/** For lib-sales' quick bill (RAD-115), reached by no route: a counter sale's receipt, its cash for the Counter customer
 * judged against the limit one bill at a time, since every walk-in shares that party (the architect's MUST); any other
 * receipt, on POST /payments too, sums the party's day. Its own function, since a route passes its service a third
 * argument. */
export function recordCounterReceipt(ctx: Ctx, input: Readonly<Omit<In<typeof recordPaymentContract>, 'kind' | 'refundOf' | 'credit'>>):
  Promise<Out<typeof recordPaymentContract>> {
  return record(ctx, { ...input, kind: 'receipt' }, null, null, true);
}

/** For a document's own service (bookings, M3-13), reached by no route: a receipt held for `heldFor` (a booking's
 * advance), refunded then only through refundHeld. Its own function, not an option on recordPayment, since a route
 * passes its service a third argument. */
export function recordHeldReceipt(ctx: Ctx, input: Readonly<Omit<In<typeof recordPaymentContract>, 'kind' | 'refundOf'>>, heldFor: HeldFor):
  Promise<Out<typeof recordPaymentContract>> {
  return record(ctx, { ...input, kind: 'receipt' }, heldFor, null);
}

/** For a credit note's own service (RAD-114), reached by no route of its own: refunds what's left of a posted credit
 * note to its party, under the same checks as any refund (its cap shared with the note's applications, its date, the
 * cash limit). The database checks the credit, by name, when the refund posts. */
export function refundCredit(ctx: Ctx, r: Readonly<Omit<In<typeof recordPaymentContract>, 'kind' | 'refundOf' | 'credit' | 'tds'> & {
  creditTable: string; creditId: string }>): Promise<Out<typeof recordPaymentContract>> {
  const { creditTable, creditId, ...rest } = r;
  return record(ctx, { ...rest, kind: 'refund', credit: { table: creditTable, id: creditId } }, null, null);
}

/** For a document's own service (bookings, M3-13), reached by no route: refunds a receipt held for `owner`, with the
 * same checks as any refund (its cap, its date, the cash limit). */
export function refundHeld(ctx: Ctx, r: Readonly<Omit<In<typeof recordPaymentContract>, 'kind' | 'refundOf' | 'tds'> & {
  receiptId: string; owner: HeldFor }>): Promise<Out<typeof recordPaymentContract>> {
  const { receiptId, owner, ...rest } = r;
  return record(ctx, { ...rest, kind: 'refund', refundOf: receiptId }, null, owner);
}

async function record(ctx: Ctx, input: In<typeof recordPaymentContract>, heldFor: HeldFor | null, owner: HeldFor | null, counter = false):
  Promise<Out<typeof recordPaymentContract>> {
  const tx = accountsTx(ctx);
  // TDS held back is optional: none when it's left out.
  const p = { ...input, tds: input.tds ?? roundMoney('0') };
  if (!dec(p.tds).lt(p.amount)) refuse('invalid_tds', 'TDS held back is less than the amount');
  if (p.kind === 'refund' && dec(p.tds).gt(0)) refuse('invalid_tds', 'A refund holds no TDS');
  if (p.businessDate > today()) refuse('date_in_future', 'The date is after today');
  // The period lock FOR SHARE first (ADR-006 §1), with year_not_open and period_locked by name.
  await holdPeriod(ctx, p.businessDate);
  if (p.kind === 'refund') {
    if ((p.refundOf === undefined) === (p.credit === undefined)) {
      return refuse('refund_needs_receipt', 'Say which receipt or credit note this refund pays back, and only one');
    }
    // A credit's checks are the database's, under the credit's lock, taken by the insert below (it can't be read here).
    if (p.refundOf !== undefined) {
      await checkRefund(ctx, { receiptId: p.refundOf, partyId: p.partyId, businessDate: p.businessDate, amount: p.amount }, owner);
    }
  } else if (p.refundOf !== undefined || p.credit !== undefined) {
    refuse('refund_needs_receipt', 'Only a refund names a receipt or a credit note');
  }
  const { cash } = await moneyAccount(ctx, p.accountId);
  const [row] = await tx.insert(payments).values({ kind: p.kind, partyId: p.partyId, businessDate: p.businessDate, amount: p.amount, tds: p.tds,
    accountId: p.accountId, refundOfId: p.refundOf ?? null, creditTable: p.credit?.table ?? null, creditId: p.credit?.id ?? null,
    narration: p.narration ?? null, reference: p.reference ?? null, heldForTable: heldFor?.table ?? null, heldForId: heldFor?.id ?? null }).returning({ id: payments.id });
  // The insert locked a credit it names (check_credit_refund), so the cash limit's party lock below comes after the
  // document's, as ADR-006 §1 orders them.
  const id = row?.id ?? refuse('server_error', 'The payment was not stored');
  if (cash && await pastCashLimit(ctx, { id, ...p }, counter)) {
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
  // The database refuses it too (payment_still_allocated); said here by name first.
  if (!(await paymentUsed(ctx, p.id)).allocated.eq(0)) refuse('has_allocations', 'Reverse what this is applied to first');
  const mirror = await reverseEntry(ctx, { entryId: p.postedEntryId, businessDate: c.businessDate, reason: c.reason });
  await tx.update(payments).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal), cancelReason: c.reason,
    cancelEntryId: mirror.id }).where(eq(payments.id, p.id));
  return {};
}
