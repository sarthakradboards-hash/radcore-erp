// Expenses (M5-02, RAD-152; ADR-009 §2, §3, §7; ADR-006 §6, F27, F28; ADR-007 §8): a supplier's bill for a cost, entered
// as a draft and posted with the bill attached, paid at once from Cash or a bank account or on credit to the supplier.
// Each line posts to one of its category's accounts (the database holds that), its input GST claimed only by lib-gst's
// inputCredit (the supplier's kind, the category's block, the heads against the supplier's state), the rest part of the
// line's cost. Paid in cash past the day's limit it waits for an owner's override, which posts it.
//   locks (ADR-009 §7): the period FOR SHARE → the expense → its party (cash limit only) → the series, the journal's first
import { accounts, accountsTx, after, expenseCategories, expenseCategoryAccounts, expenseLines, expenses, parties } from '@radcore/db/accounts';
import { dec, indiaDate, roundMoney, type Decimal, type Money } from '@radcore/lib-common';
import { creditFrom, inputCredit, supplierKind, type Credit } from '@radcore/lib-gst';
import {
  AppError, awaitingApproval, decodeCursor, defineSeries, encodeCursor, holdSeries, isoMoment, listScope, momentKey, nextNumber, principalId, readyFile,
  requestApproval, withdrawPending, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelExpense, createExpense, dropExpense, getExpense, listExpenses, postExpense, replaceExpense } from '../contract-expenses.ts';
import { getCompanyProfile } from './company.ts';
import { holdPeriod, JOURNAL_SERIES, lockPeriod, postEntry, reverseEntry, type JournalLine } from './journal.ts';
import { holdParty } from './parties.ts';
import { cashPaidOn } from './expense-cash.ts';
import { bookTds, defaultTdsSection, reverseTds } from './tds-booking.ts';
import { CASH_PAYMENT_LIMIT, moneyAccount } from './payments.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Row = typeof expenses.$inferSelect;
type Draft = In<typeof createExpense>;

/** Expenses' numbers: EX/YY-YY/NNNN, drawn as the last step of posting. */
export const EXPENSE_SERIES = defineSeries('accounts.expense', 'EX', { label: 'Expenses' });
const SOURCE = 'expenses';
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const today = () => indiaDate(new Date());
const zero = () => dec('0');
const refuseAt = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This expense is ${status}, so it can’t be ${what}`);

/** The expense within the principal's scope for `key`, by its maker, else not_found; locked when it's to change. */
async function expenseOf(ctx: Ctx, id: string, key: string, forUpdate = false): Promise<Row> {
  const q = accountsTx(ctx).select().from(expenses).where(eq(expenses.id, id)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw new AppError('not_found', 'There’s no such expense');
  ctx.see(key, { owner: row.createdBy });
  return row;
}

type Party = { gstin: string | null; composition: boolean; stateCode: string };
/** A draft's checks (ADR-009 §3): the dates, the supplier (needed on credit) and the GSTIN printed, the money account, the
 * file, and each line's category switched on with that account in it. Answers the supplier, whether it's paid in cash,
 * and each line's category's credit rule. */
async function checkDraft(ctx: Ctx, e: Draft): Promise<{ party: Party | null; cash: boolean; blocked: boolean[]; sections: (string | null)[] }> {
  if (e.businessDate > today()) throw refuseAt('date_in_future', 'The date is after today', ['businessDate']);
  if (e.supplierInvoiceDate > e.businessDate) {
    throw refuseAt('supplier_date_after_bill', 'The supplier’s date is after the expense’s own', ['supplierInvoiceDate']);
  }
  if (e.supplierId === null && e.payFromAccountId === null) {
    throw refuseAt('needs_supplier', 'Name the supplier of an expense on credit', ['supplierId']);
  }
  const tx = accountsTx(ctx);
  let party: Party | null = null;
  if (e.supplierId !== null) {
    const [p] = await tx.select({ supplier: parties.supplier, gstin: parties.gstin, composition: parties.composition, stateCode: parties.stateCode,
      active: parties.active }).from(parties).where(eq(parties.id, e.supplierId)).limit(1);
    if (p === undefined || !p.supplier || !p.active) throw refuseAt('not_a_supplier', 'Pick a supplier we buy from', ['supplierId']);
    // The GSTIN as printed must be the party's own, or none for an unregistered supplier (ADR-009 §3).
    if (e.supplierGstin !== p.gstin) {
      throw refuseAt('gstin_mismatch', p.gstin === null ? 'This supplier has no GSTIN on record' : `The supplier’s GSTIN is ${p.gstin}`, ['supplierGstin']);
    }
    party = p;
  } else if (e.supplierGstin !== null) {
    // ADR-010's inward view reads the GSTIN with its supplier: none without one (the auditor on #435).
    throw refuseAt('gstin_mismatch', 'Name the supplier whose GSTIN this is, or leave the GSTIN out', ['supplierGstin']);
  }
  const cash = e.payFromAccountId === null ? false : (await moneyAccount(ctx, e.payFromAccountId)).cash;
  if (e.fileId !== null) await readyFile(ctx, 'expense_bill', e.fileId, { wrongKind: ['fileId'] });
  const pairs = await tx.select({ categoryId: expenseCategoryAccounts.categoryId, accountId: expenseCategoryAccounts.accountId,
    credit: expenseCategories.credit, categoryActive: expenseCategories.active, accountActive: accounts.active,
    defaultTds: expenseCategories.defaultTdsSectionId })
    .from(expenseCategoryAccounts).innerJoin(expenseCategories, eq(expenseCategories.id, expenseCategoryAccounts.categoryId))
    .innerJoin(accounts, eq(accounts.id, expenseCategoryAccounts.accountId))
    .where(inArray(expenseCategoryAccounts.categoryId, [...new Set(e.lines.map((l) => l.categoryId))]));
  const categoryTds = new Map<string, string | null>();
  const blocked = e.lines.map((l, n) => {
    const pair = pairs.find((p) => p.categoryId === l.categoryId && p.accountId === l.accountId);
    if (pair === undefined) throw refuseAt('not_in_category', 'That account isn’t one this category posts to', ['lines', n, 'accountId']);
    if (!pair.categoryActive) throw refuseAt('category_inactive', 'This category is switched off', ['lines', n, 'categoryId']);
    if (!pair.accountActive) throw refuseAt('account_inactive', 'This account is switched off', ['lines', n, 'accountId']);
    categoryTds.set(l.categoryId, pair.defaultTds);
    return pair.credit === 'blocked';
  });
  // A line's TDS section (ADR-009 §4): its own (null for none), else the supplier's default, else its category's.
  const partyDefault = await defaultTdsSection(ctx, e.supplierId);
  const sections = e.lines.map((l) => (l.tdsSectionId !== undefined ? l.tdsSectionId : partyDefault ?? categoryTds.get(l.categoryId) ?? null));
  return { party, cash, blocked, sections };
}

const headerOf = (e: Draft) => ({ businessDate: e.businessDate, partyId: e.supplierId, supplierInvoiceNumber: e.supplierInvoiceNumber,
  supplierInvoiceDate: e.supplierInvoiceDate, supplierGstin: e.supplierGstin, payFromAccountId: e.payFromAccountId, statedTotal: e.statedTotal,
  // What the supplier is owed: the whole on credit, nothing when paid at once (ck_expenses_owed).
  total: e.payFromAccountId === null ? e.statedTotal : roundMoney('0'), fileId: e.fileId, notes: e.notes });
const linesOf = (id: string, e: Draft, sections: readonly (string | null)[]) => e.lines.map((l, i) => ({ expenseId: id, lineNo: i + 1,
  categoryId: l.categoryId, accountId: l.accountId, description: l.description, taxable: l.taxable, gstRate: l.gstRate, cgst: l.cgst, sgst: l.sgst,
  igst: l.igst, tdsSectionId: sections[i] ?? null }));

/** POST /expenses: a new draft. */
export async function addExpense(ctx: Ctx, e: Draft): Promise<Out<typeof createExpense>> {
  const { sections } = await checkDraft(ctx, e);
  const tx = accountsTx(ctx);
  const [row] = await tx.insert(expenses).values(headerOf(e)).returning({ id: expenses.id });
  const id = row?.id ?? '';
  await tx.insert(expenseLines).values(linesOf(id, e, sections));
  return { id };
}

/** PUT /expenses/:id: a draft replaced whole. */
export async function changeExpense(ctx: Ctx, { id, ...e }: In<typeof replaceExpense>): Promise<Out<typeof replaceExpense>> {
  const row = await expenseOf(ctx, id, 'expenses:write', true);
  if (row.status !== 'draft') throw wrongStatus(row.status, 'changed');
  const { sections } = await checkDraft(ctx, e);
  const tx = accountsTx(ctx);
  await tx.update(expenses).set(headerOf(e)).where(eq(expenses.id, id));
  await tx.delete(expenseLines).where(eq(expenseLines.expenseId, id));
  await tx.insert(expenseLines).values(linesOf(id, e, sections));
  return {};
}

/** DELETE /expenses/:id: a draft dropped, its cash override withdrawn if one waits. */
export async function dropExpenseDraft(ctx: Ctx, { id }: In<typeof dropExpense>): Promise<Out<typeof dropExpense>> {
  const row = await expenseOf(ctx, id, 'expenses:write', true);
  if (row.status !== 'draft') throw wrongStatus(row.status, 'dropped');
  await withdrawPending(ctx, expenseCashSpec, id);
  await accountsTx(ctx).delete(expenses).where(eq(expenses.id, id));
  return {};
}

const draftOf = async (ctx: Ctx, e: Row): Promise<{ draft: Draft; lines: (typeof expenseLines.$inferSelect)[] }> => {
  const lines = await accountsTx(ctx).select().from(expenseLines).where(eq(expenseLines.expenseId, e.id)).orderBy(asc(expenseLines.lineNo));
  const m = (v: string) => roundMoney(v);
  return { lines, draft: { businessDate: e.businessDate, supplierId: e.partyId, supplierInvoiceNumber: e.supplierInvoiceNumber,
    supplierInvoiceDate: e.supplierInvoiceDate, supplierGstin: e.supplierGstin, payFromAccountId: e.payFromAccountId, statedTotal: m(e.statedTotal),
    fileId: e.fileId, notes: e.notes, lines: lines.map((l) => ({ categoryId: l.categoryId, accountId: l.accountId, description: l.description,
      taxable: m(l.taxable), gstRate: l.gstRate as never, cgst: m(l.cgst), sgst: m(l.sgst), igst: m(l.igst), tdsSectionId: l.tdsSectionId })) } };
};

/** Each head as printed against the rate on the taxable value, within the round-off (`tax_mismatch`): CGST and SGST at
 * half the rate each, or IGST at the whole of it. */
function taxFits(l: Draft['lines'][number]): boolean {
  const taxable = dec(l.taxable);
  const half = dec(roundMoney(taxable.times(dec(l.gstRate)).div('200')));
  const whole = dec(roundMoney(taxable.times(dec(l.gstRate)).div('100')));
  return dec(l.igst).gt(0) ? dec(l.igst).minus(whole).abs().lt(1) : dec(l.cgst).minus(half).abs().lt(1);
}

/** Whether this cash, with the supplier's other posted cash that day (payments and cash expenses), passes the day's limit
 * (ADR-007 §8, section 40A(3)). One with no supplier is judged alone. */
async function pastCashLimit(ctx: Ctx, e: Row): Promise<boolean> {
  const limit = dec(ctx.settings.get(CASH_PAYMENT_LIMIT));
  if (e.partyId === null) return dec(e.statedTotal).gt(limit);
  // ADR-006 §1 step 3: the party after the expense's own row, so two cash saves for one supplier take turns.
  await holdParty(ctx, e.partyId);
  // One figure per supplier per day with their cash payments (section 40A(3); the architect on #435).
  return dec(e.statedTotal).plus(await cashPaidOn(ctx, e.partyId, e.businessDate, { expense: e.id })).gt(limit);
}

/** Posts a draft, or asks for the owner's override when it's cash past the limit and not yet approved. */
async function post(ctx: Ctx, id: string, approved: boolean): Promise<Out<typeof postExpense>> {
  const tx = accountsTx(ctx);
  // Its poster under expenses:write, or the owner deciding its override under payments:approve (as bills, ADR-008 §13).
  const key = approved ? 'payments:approve' : 'expenses:write';
  // The period first, so the draft is read unlocked to learn its date, then locked.
  const seen = await expenseOf(ctx, id, key);
  await holdPeriod(ctx, seen.businessDate);
  const e = await expenseOf(ctx, id, key, true);
  if (e.status !== 'draft') throw wrongStatus(e.status, 'posted');
  const { draft, lines } = await draftOf(ctx, e);
  const { party, cash, blocked, sections } = await checkDraft(ctx, draft);
  if (e.fileId === null) throw refuseAt('bill_file_required', 'Attach the supplier’s bill before posting it', ['fileId']);
  for (const [n, l] of draft.lines.entries()) {
    if (!taxFits(l)) throw refuseAt('tax_mismatch', 'The tax on this line doesn’t match its rate on the taxable value', ['lines', n]);
  }
  const linesTotal = draft.lines.reduce((s, l) => s.plus(dec(l.taxable)).plus(dec(l.cgst)).plus(dec(l.sgst)).plus(dec(l.igst)), zero());
  const roundOff = dec(e.statedTotal).minus(linesTotal);
  if (roundOff.abs().gte(1)) {
    throw refuseAt('total_mismatch', `The lines come to ${roundMoney(linesTotal)}, not the ${e.statedTotal} the bill states`, ['statedTotal']);
  }
  const { company } = await getCompanyProfile(ctx);
  if (company === null) throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state to judge input credit');
  if (cash && !approved && await pastCashLimit(ctx, e)) {
    await requestApproval(ctx, expenseCashSpec, id);
    return { status: 'pending_approval', number: null };
  }
  // Input credit by ADR-009 §2: the heads as printed, against the supplier's state; none without a supplier.
  const from = creditFrom(ctx);
  const credits: Credit[] = draft.lines.map((l, i) => inputCredit({ tax: l, kind: party === null ? 'unregistered' : supplierKind(party),
    creditFrom: from, blocked: blocked[i] ?? true, intraState: party === null || party.stateCode === company.stateCode }));
  const heads = (l: { cgst: string; sgst: string; igst: string }): Decimal => dec(l.cgst).plus(dec(l.sgst)).plus(dec(l.igst));
  const claimed = (head: 'cgst' | 'sgst' | 'igst') => credits.reduce((s, c) => s.plus(dec(c[head])), zero());
  const signed = (account: JournalLine['account'], v: Decimal, more: Partial<JournalLine> = {}): JournalLine[] =>
    (v.isZero() ? [] : [{ account, ...more, ...(v.gt(0) ? { debit: roundMoney(v) } : { credit: roundMoney(v.abs()) }) }]);
  const entryLines: JournalLine[] = [
    // Each line's account takes its taxable value and the GST it doesn't claim (F27, F28).
    ...draft.lines.flatMap((l, i) => signed({ id: l.accountId }, dec(l.taxable).plus(heads(l)).minus(heads(credits[i] ?? l)))),
    ...signed({ system: 'input_cgst' }, claimed('cgst')), ...signed({ system: 'input_sgst' }, claimed('sgst')),
    ...signed({ system: 'input_igst' }, claimed('igst')),
    ...signed({ system: 'round_off' }, roundOff),
  ];
  // TDS on the lines with a section (ADR-009 §4, F12): booked here, the party's row after the expense's; the supplier or
  // the cash is the bill less it, the rest to TDS Payable.
  const tds = await bookTds(ctx, { table: SOURCE, id, partyId: e.partyId, businessDate: e.businessDate }, lines.flatMap((l, i) => {
    const s = sections[i];
    return s == null ? [] : [{ lineId: l.id, sectionId: s, base: l.taxable, payable: roundMoney(dec(l.taxable).plus(heads(l))), path: ['lines', i] }];
  }));
  const net = roundMoney(dec(e.statedTotal).minus(dec(tds.total)));
  entryLines.push(...signed({ system: 'tds_payable' }, dec(tds.total).negated()),
    e.payFromAccountId === null ? { account: { system: 'creditors' }, partyId: e.partyId ?? '', credit: net } : { account: { id: e.payFromAccountId }, credit: net });
  // The lines' credit while it's a draft (guard_document_line), then the journal's and the expenses' series, last.
  for (const [i, l] of lines.entries()) {
    const c = credits[i];
    if (c !== undefined) {
      await tx.update(expenseLines).set({ creditCgst: c.cgst, creditSgst: c.sgst, creditIgst: c.igst, creditReason: c.reason })
        .where(eq(expenseLines.id, l.id));
    }
  }
  await holdSeries(ctx, [JOURNAL_SERIES, EXPENSE_SERIES]);
  const number = await nextNumber(ctx, EXPENSE_SERIES, e.businessDate);
  const entry = await postEntry(ctx, { kind: 'expense', businessDate: e.businessDate, source: { table: SOURCE, id }, lines: entryLines });
  await tx.update(expenses).set({ status: 'posted', number, postedEntryId: entry.id, tds: tds.total,
    total: e.payFromAccountId === null ? net : roundMoney('0') }).where(eq(expenses.id, id));
  return { status: 'posted', number };
}

type Version = { businessDate: string; partyId: string | null; payFromAccountId: string | null; statedTotal: string; fileId: string | null;
  supplierGstin: string | null; supplierInvoiceNumber: string; supplierInvoiceDate: string;
  lines: { categoryId: string; accountId: string; taxable: string; cgst: string; sgst: string; igst: string; tdsSectionId: string | null }[] };
/** What an owner approves for cash past the limit (ADR-007 §8): the expense's figures and lines, the row locked while
 * they're read. Its approval posts the expense, past the limit. */
export const expenseCashSpec: ApprovalSpec<Version> = {
  kind: 'expense-cash',
  table: 'expenses',
  async version(ctx, id, { forUpdate }) {
    const q = accountsTx(ctx).select().from(expenses).where(eq(expenses.id, id)).limit(1);
    const [e] = forUpdate ? await q.for('update') : await q;
    // Its poster asks (expenses:write) and an owner decides (payments:approve); outside both, there's no such expense.
    if (e === undefined || (!ctx.can('expenses:write', { owner: e.createdBy }) && !ctx.can('payments:approve', { owner: e.createdBy }))) return null;
    const lines = await accountsTx(ctx).select().from(expenseLines).where(eq(expenseLines.expenseId, id)).orderBy(asc(expenseLines.lineNo));
    const m = (v: string) => roundMoney(v);
    return { businessDate: e.businessDate, partyId: e.partyId, payFromAccountId: e.payFromAccountId, statedTotal: m(e.statedTotal), fileId: e.fileId,
      supplierGstin: e.supplierGstin, supplierInvoiceNumber: e.supplierInvoiceNumber, supplierInvoiceDate: e.supplierInvoiceDate,
      lines: lines.map((l) => ({ categoryId: l.categoryId, accountId: l.accountId, taxable: m(l.taxable), cgst: m(l.cgst), sgst: m(l.sgst), igst: m(l.igst),
        tdsSectionId: l.tdsSectionId })) };
  },
  // The period's locks first, before the engine locks the expense, refusing nothing; posting checks under the same locks.
  async lockFirst(ctx) {
    await lockPeriod(ctx);
  },
  async approved(ctx, id) {
    await post(ctx, id, true);
  },
  async rejected() {},
};

/** POST /expenses/:id/post. */
export const postExpenseNow = (ctx: Ctx, { id }: In<typeof postExpense>): Promise<Out<typeof postExpense>> => post(ctx, id, false);

/** POST /expenses/:id/cancel: a mirror entry dated the cancel's day (an inward document's credit comes back in the open
 * month, ADR-009 §5), refused by the database while anything is applied to it (document_still_applied). */
export async function cancelExpenseNow(ctx: Ctx, c: In<typeof cancelExpense>): Promise<Out<typeof cancelExpense>> {
  if (c.businessDate > today()) throw refuseAt('date_in_future', 'The date is after today', ['businessDate']);
  await holdPeriod(ctx, c.businessDate);
  const e = await expenseOf(ctx, c.id, 'expenses:write', true);
  if (e.status !== 'posted' || e.postedEntryId === null) throw wrongStatus(e.status, 'cancelled');
  if (c.businessDate < e.businessDate) throw refuseAt('date_before_source', 'A cancellation is dated on or after what it cancels', ['businessDate']);
  const mirror = await reverseEntry(ctx, { entryId: e.postedEntryId, businessDate: c.businessDate, reason: c.reason });
  await reverseTds(ctx, { table: SOURCE, id: e.id, businessDate: c.businessDate });
  await accountsTx(ctx).update(expenses).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: c.reason, cancelEntryId: mirror.id }).where(eq(expenses.id, e.id));
  return {};
}

/** GET /expenses: newest business date first, then the moment entered, then id. */
export async function listExpensesPage(ctx: Ctx, input: In<typeof listExpenses>): Promise<Out<typeof listExpenses>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await accountsTx(ctx).select().from(expenses).where(and(
    input.filter.status === undefined ? undefined : eq(expenses.status, input.filter.status),
    listScope(ctx, 'expenses:read', expenses.createdBy),
    after([expenses.businessDate, expenses.createdAt, expenses.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(expenses.businessDate), desc(expenses.createdAt), desc(expenses.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const waiting = await awaitingApproval(ctx, expenseCashSpec, page.map((r) => r.id));
  const last = page.at(-1);
  return { items: page.map((r) => headerOut(r, waiting.has(r.id))),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null };
}

const headerOut = (r: Row, waiting: boolean) => ({ id: r.id, number: r.number, status: r.status as 'draft', businessDate: r.businessDate,
  supplierId: r.partyId, supplierInvoiceNumber: r.supplierInvoiceNumber, statedTotal: roundMoney(r.statedTotal), onCredit: r.payFromAccountId === null,
  awaitingApproval: waiting, tds: roundMoney(r.tds), createdAt: isoMoment(r.createdAt) });

/** GET /expenses/:id: with its lines and, once posted, each line's credit. */
export async function getExpenseById(ctx: Ctx, { id }: In<typeof getExpense>): Promise<Out<typeof getExpense>> {
  const e = await expenseOf(ctx, id, 'expenses:read');
  const { lines } = await draftOf(ctx, e);
  const waiting = await awaitingApproval(ctx, expenseCashSpec, [id]);
  const m = (v: string) => roundMoney(v) as Money;
  return { ...headerOut(e, waiting.has(id)), supplierInvoiceDate: e.supplierInvoiceDate, supplierGstin: e.supplierGstin,
    payFromAccountId: e.payFromAccountId, fileId: e.fileId, notes: e.notes, cancelReason: e.cancelReason,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, categoryId: l.categoryId, accountId: l.accountId, description: l.description,
      taxable: m(l.taxable), gstRate: l.gstRate as never, cgst: m(l.cgst), sgst: m(l.sgst), igst: m(l.igst),
      tdsSectionId: l.tdsSectionId, credit: l.creditCgst === null ? null : { cgst: m(l.creditCgst), sgst: m(l.creditSgst ?? '0'), igst: m(l.creditIgst ?? '0'),
        reason: l.creditReason as 'state' | null } })) };
}
