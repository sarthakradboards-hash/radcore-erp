// The period lock and year close (M5-09, RAD-157; ADR-009 §6, §7; RC-039, RC-163). The lock moves forward freely under
// books:lock, and back only when someone else holding books:unlock approves (D-06). A year closes once the lock is at or
// past its 31 March, so nothing in it can change while the close reads it, and its `year_close` entry (F20) moves the
// year's income and expenses to Retained Earnings. Every move takes ADR-006 §1's step 1 with the period lock FOR UPDATE
// (lockPeriodForMove), so it waits for the postings in flight.
// The close runs read committed, not ADR-009 §6's repeatable read: a write can't (ADR-002 §4), and it needn't, since
// once the lock row is held FOR UPDATE and the lock is at or past 31 March, nothing dated in the year can commit.
import {
  accounts, accountsTx, company, financialYears, journalEntries, journalLines, periodUnlockRequests, setPeriodLock, yearCloses,
} from '@radcore/db/accounts';
import { dec, financialYear, indiaDate, roundMoney } from '@radcore/lib-common';
import { AppError, defineSetting, principalsOf, requestApproval, type ApprovalSpec, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { askUnlockContract, closeYearContract, getPeriodContract, lockPeriodContract } from '../contract-period.ts';
import { filedLockRow, periodLockRow, postEntry, reverseEntry, type JournalLine } from './journal.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
const today = () => indiaDate(new Date());

/** CA-25's list until the CA says otherwise (ADR-009 §6, §8): the items a close must tick, separated by semicolons. */
export const YEAR_END_CHECKLIST = defineSetting('accounts.year_end_checklist', z.string().trim().min(1).max(1000),
  'Depreciation; Provisions; Income tax; Interest; Stock valuation agreed', {
    label: 'Year-end checklist',
    description: 'What must be done before a year is closed, separated by semicolons. Each item is ticked when the year is closed.',
    input: { kind: 'text' },
  });
const checklistOf = (ctx: Ctx) => ctx.settings.get(YEAR_END_CHECKLIST).split(';').map((s) => s.trim()).filter((s) => s !== '');

/**
 * ADR-009 §7's step 1 for a move of a lock: the company profile FOR SHARE, then the period lock and the filed-month row,
 * the one being moved FOR UPDATE and the other FOR SHARE (`period` for a move of the period lock, a close or a reopen;
 * `filed` for marking or undoing a filing). So it waits for the postings in flight and none starts until it commits.
 * Like lockPeriod it takes locks and refuses nothing, so an approval's lockFirst can call it for a reject too. Answers
 * where the period lock stands.
 */
export async function lockPeriodForMove(ctx: Ctx, which: 'period' | 'filed'): Promise<string | null> {
  await accountsTx(ctx).select({ id: company.id }).from(company).for('share');
  const [lock] = await periodLockRow(ctx).for(which === 'period' ? 'update' : 'share');
  await filedLockRow(ctx).for(which === 'filed' ? 'update' : 'share');
  return lock?.through ?? null;
}

/** The live (not reopened) closes, by their year's start. */
async function liveCloses(ctx: Ctx) {
  return accountsTx(ctx).select({ id: yearCloses.id, fyStart: yearCloses.fyStart, at: yearCloses.createdAt, by: yearCloses.createdBy })
    .from(yearCloses).where(isNull(yearCloses.reopenedAt));
}

/** GET /books/period: the lock, each opened year with its live close, and the checklist. */
export async function periodState(ctx: Ctx): Promise<Out<typeof getPeriodContract>> {
  const [lock] = await periodLockRow(ctx);
  const years = await accountsTx(ctx).select({ start: financialYears.start }).from(financialYears).orderBy(desc(financialYears.start));
  const closes = await liveCloses(ctx);
  const principal = await principalsOf(ctx, closes.map((c) => c.by));
  return {
    lockedThrough: lock?.through ?? null,
    years: years.map(({ start }) => {
      const c = closes.find((x) => x.fyStart === start);
      return { start, label: financialYear(start).label, closed: c === undefined ? null : { id: c.id, at: c.at.toISOString(), by: principal(c.by) } };
    }),
    checklist: checklistOf(ctx),
  };
}

/** POST /books/period/lock: forward only, to a day before today (ADR-009 §6). */
export async function moveLockForward(ctx: Ctx, { through }: In<typeof lockPeriodContract>): Promise<Out<typeof lockPeriodContract>> {
  const lock = await lockPeriodForMove(ctx, 'period');
  if (through >= today()) refuse('lock_in_future', 'Lock the books only through a day before today');
  if (lock !== null && through <= lock) {
    refuse('lock_not_forward', `The books are locked through ${lock}: ask to move the lock back instead`);
  }
  await setPeriodLock(ctx.tx, through);
  return { lockedThrough: through };
}

/** What a move back to `through`, or a reopen, may not do to the closed years (ADR-009 §6), asked and approved alike. */
async function checkUnlock(ctx: Ctx, kind: 'move_back' | 'reopen_year', through: string, lock: string | null): Promise<void> {
  if (lock === null || through >= lock) refuse('lock_not_back', `The books are locked through ${lock ?? 'no date'}: that’s no move back`);
  const closes = await liveCloses(ctx);
  if (kind === 'move_back') {
    const closed = closes.find((c) => financialYear(c.fyStart).end > through);
    if (closed !== undefined) refuse('year_closed', `${financialYear(closed.fyStart).label} is closed: ask to reopen it first`);
    return;
  }
  const year = financialYear(through);
  if (!closes.some((c) => c.fyStart === year.start)) refuse('year_not_closed', `${year.label} isn’t closed`);
  if (closes.some((c) => c.fyStart > year.start)) refuse('later_year_closed', 'Only the latest closed year can be reopened');
}

/** POST /books/period/unlock-requests: the request, and its approval asked for (`period-unlock`). */
export async function askToUnlock(ctx: Ctx, r: In<typeof askUnlockContract>): Promise<Out<typeof askUnlockContract>> {
  const [lock] = await periodLockRow(ctx).for('share');
  await checkUnlock(ctx, r.kind, r.through, lock?.through ?? null);
  const [row] = await accountsTx(ctx).insert(periodUnlockRequests)
    .values({ kind: r.kind, through: r.through, reason: r.reason, lockWas: lock?.through ?? '' }).returning({ id: periodUnlockRequests.id });
  if (row === undefined) throw new Error('The request was not saved');
  return requestApproval(ctx, periodUnlockSpec, row.id);
}

type UnlockVersion = { kind: string; through: string; reason: string; lockedThrough: string | null };

/**
 * A move back or a reopen (D-06). The version names the lock as it stands while the request waits, so one the lock moved
 * past since it was asked is stale (`version_changed`); once applied, the lock it moved from, which is what was
 * approved. lockFirst takes the period lock FOR UPDATE before the request, so two decisions take turns (ADR-009 §7).
 */
export const periodUnlockSpec: ApprovalSpec<UnlockVersion> = {
  kind: 'period-unlock',
  table: 'period_unlock_requests',
  async version(ctx, id, { forUpdate }) {
    const q = accountsTx(ctx).select().from(periodUnlockRequests).where(eq(periodUnlockRequests.id, id)).limit(1);
    const [r] = forUpdate ? await q.for('update') : await q;
    if (r === undefined) return null;
    const [lock] = r.appliedAt === null ? await periodLockRow(ctx) : [{ through: r.lockWas }];
    return { kind: r.kind, through: r.through, reason: r.reason, lockedThrough: lock?.through ?? null };
  },
  async lockFirst(ctx) {
    await lockPeriodForMove(ctx, 'period');
  },
  async approved(ctx, id) {
    const tx = accountsTx(ctx);
    const [r] = await tx.select().from(periodUnlockRequests).where(eq(periodUnlockRequests.id, id)).limit(1);
    if (r === undefined) return refuse('not_found', 'There’s no such request');
    const kind = z.enum(['move_back', 'reopen_year']).parse(r.kind);
    // The closes may have changed since it was asked (a year closed since): judged again, under the lock.
    await checkUnlock(ctx, kind, r.through, r.lockWas);
    if (kind === 'reopen_year') await reopen(ctx, financialYear(r.through).start, id);
    await setPeriodLock(ctx.tx, r.through);
    await tx.update(periodUnlockRequests).set({ appliedAt: new Date() }).where(eq(periodUnlockRequests.id, id));
  },
  async rejected() {},
};

/** Reverses the year's close, dated its 31 March (ADR-006 §3's one exception), and marks it reopened by `requestId`. */
async function reopen(ctx: Ctx, fyStart: string, requestId: string): Promise<void> {
  const tx = accountsTx(ctx);
  const [close] = await tx.select({ id: yearCloses.id }).from(yearCloses)
    .where(and(eq(yearCloses.fyStart, fyStart), isNull(yearCloses.reopenedAt))).limit(1).for('update');
  if (close === undefined) return refuse('year_not_closed', `${financialYear(fyStart).label} isn’t closed`);
  // A close with nothing to move posted no entry.
  const [entry] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.sourceTable, 'year_closes'),
    eq(journalEntries.sourceId, close.id), eq(journalEntries.kind, 'year_close'), isNull(journalEntries.reversesEntryId))).limit(1);
  if (entry !== undefined) await reverseEntry(ctx, { entryId: entry.id, businessDate: financialYear(fyStart).end });
  await tx.update(yearCloses).set({ reopenedAt: new Date(), reopenedBy: requestId }).where(eq(yearCloses.id, close.id));
}

/** The books check as at a date (lib-service's, which lib-accounts can't import): what disagrees, none when healthy. */
export type BooksCheck = (ctx: Ctx, asAt: string) => Promise<readonly unknown[]>;

/** POST /books/years/:start/close (F20): in ADR-009 §6's order, under the lock held FOR UPDATE. */
export async function closeYear(ctx: Ctx, input: In<typeof closeYearContract>, booksCheck: BooksCheck): Promise<Out<typeof closeYearContract>> {
  const tx = accountsTx(ctx);
  const year = financialYear(input.start);
  const lock = await lockPeriodForMove(ctx, 'period');
  const [open] = await tx.select({ start: financialYears.start }).from(financialYears).where(eq(financialYears.start, year.start)).limit(1);
  if (open === undefined) refuse('year_not_open', `The financial year ${year.label} isn’t open`);
  if (lock === null || lock < year.end) refuse('lock_before_year_end', `Lock the books through ${year.end} before closing ${year.label}`);
  const closed = new Set((await liveCloses(ctx)).map((c) => c.fyStart));
  if (closed.has(year.start)) refuse('year_closed', `${year.label} is already closed`);
  const earlier = await tx.select({ start: financialYears.start }).from(financialYears).where(lt(financialYears.start, year.start));
  const unclosed = earlier.find((y) => !closed.has(y.start));
  if (unclosed !== undefined) refuse('earlier_year_open', `Close ${financialYear(unclosed.start).label} first`);
  const checklist = checklistOf(ctx);
  const missing = checklist.filter((item) => !input.ticks.includes(item));
  if (missing.length > 0) refuse('checklist_incomplete', `Not ticked yet: ${missing.join('; ')}`);
  if ((await booksCheck(ctx, year.end)).length > 0) {
    refuse('books_check_failed', `The books check finds problems as at ${year.end}: put them right before closing`);
  }
  const [row] = await tx.insert(yearCloses).values({ fyStart: year.start, ticks: checklist }).returning({ id: yearCloses.id });
  if (row === undefined) throw new Error('The close was not saved');
  const lines = await closingLines(ctx, year.start);
  const entry = lines.length === 0 ? null
    : await postEntry(ctx, { kind: 'year_close', businessDate: year.end, source: { table: 'year_closes', id: row.id }, lines });
  return { id: row.id, entry: entry?.number ?? null };
}

/** F20's lines: each income and expense account's balance for the year reversed, the difference to Retained Earnings.
 * A year reopened and closed again reads its old close and that close's reversal too, which add up to nothing. */
async function closingLines(ctx: Ctx, fyStart: string): Promise<JournalLine[]> {
  const rows = await accountsTx(ctx).select({ id: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.fyStart, fyStart), inArray(accounts.type, ['income', 'expense'])));
  const net = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) net.set(r.id, (net.get(r.id) ?? dec('0')).plus(dec(r.debit)).minus(dec(r.credit)));
  const lines: JournalLine[] = [];
  let left = dec('0');
  for (const [id, n] of [...net].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (n.isZero()) continue;
    left = left.plus(n);
    lines.push(n.gt(0) ? { account: { id }, credit: roundMoney(n) } : { account: { id }, debit: roundMoney(n.neg()) });
  }
  if (lines.length > 0 && !left.isZero()) {
    lines.push(left.gt(0) ? { account: { system: 'retained_earnings' }, debit: roundMoney(left) }
      : { account: { system: 'retained_earnings' }, credit: roundMoney(left.neg()) });
  }
  return lines;
}
