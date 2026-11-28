// The filed-month lock (M5-08, RAD-156; ADR-009 §5, §7; RC-012). Marking a month's return filed moves that return's
// `…_through` to the month's last day, after which the journal engine (refuseFiled) and the database's trigger refuse
// every entry that return reports dated in it. Marking takes ADR-009 §7's step 1 with the filed-month row FOR UPDATE
// (lockPeriodForMove('filed')), so it waits for the postings in flight and none starts until it commits.
//   locks: the profile and the period lock FOR SHARE → the filed-month row FOR UPDATE → the filing row
import { accounts, accountsTx, after, filingUndoRequests, gstFilings, journalEntries, journalLines, setFiledLock } from '@radcore/db/accounts';
import { addDays, indiaDate, period, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSetting, encodeCursor, principalsOf, requestApproval, versionHash, type ApprovalSpec, type Ctx }
  from '@radcore/lib-platform';
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { askFilingUndo, listGstFilings, markGstFiling } from '../contract-filings.ts';
import { filedLockRow } from './journal.ts';
import { lockPeriodForMove } from './period-lock.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };

/** How often the returns are filed (CA-03): monthly, the only value built; QRMP waits on the CA (ADR-010). */
export const FILING_FREQUENCY = defineSetting('gst.filing_frequency', z.enum(['monthly']), 'monthly', {
  label: 'GST filing frequency',
  description: 'How often GSTR-1 and GSTR-3B are filed. Only monthly is built.',
  input: { kind: 'choice', choices: [{ value: 'monthly', label: 'Monthly' }] },
});
/** The first month RadCore files (ADR-009 §5), set at go-live: each later month is marked only after the one before. */
export const FILING_START = defineSetting('gst.filing_start', z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(), null, {
  label: 'First month filed from RadCore',
  description: 'The first month whose returns are marked filed here, as YYYY-MM. Each later month is marked after the one before.',
  input: { kind: 'text' },
});

/** A month's first and last days, and the month before, from YYYY-MM. */
function monthOf(month: string): { first: string; last: string; before: string } {
  const { start, end } = period(`${month}-01`);
  return { first: start, last: end, before: period(addDays(start, -1)).label };
}

/** POST /gst/filings: in ADR-009 §5's order, under the filed-month row held FOR UPDATE. */
/** Whether `ret` is marked filed, and not undone, for `month` (YYYY-MM): an invoice amendment needs its GSTR-1 filed
 * (ADR-010 §5). Steady under ADR-009 §7's step 1 (lockPeriod), which holds the filed-month row FOR SHARE against a mark or undo. */
export async function returnFiled(ctx: Ctx, ret: 'gstr1' | 'gstr3b', month: string): Promise<boolean> {
  const rows = await accountsTx(ctx).select({ id: gstFilings.id }).from(gstFilings)
    .where(and(eq(gstFilings.return, ret), eq(gstFilings.month, `${month}-01`), isNull(gstFilings.undoneAt))).limit(1);
  return rows.length > 0;
}

export async function markFiling(ctx: Ctx, f: In<typeof markGstFiling>): Promise<Out<typeof markGstFiling>> {
  await lockPeriodForMove(ctx, 'filed');
  const tx = accountsTx(ctx);
  const today = indiaDate(new Date());
  const { first, last, before } = monthOf(f.month);
  if (last >= today) refuse('month_not_ended', `${f.month} hasn’t ended yet: mark it filed once it has`);
  if (f.filedOn > today) refuse('date_in_future', 'The filing date is after today');
  if (f.filedOn <= last) refuse('filed_before_month_end', `A return for ${f.month} is filed after the month ends`);
  const start = ctx.settings.get(FILING_START);
  if (start === null) return refuse('filing_start_not_set', 'Set the first month filed from RadCore (gst.filing_start) first');
  const live = (month: string) => tx.select({ id: gstFilings.id }).from(gstFilings)
    .where(and(eq(gstFilings.return, f.return), eq(gstFilings.month, `${month}-01`), isNull(gstFilings.undoneAt))).limit(1);
  if ((await live(f.month)).length > 0) refuse('already_filed', `${f.return.toUpperCase()} is already filed for ${f.month}`);
  if (f.month < start) refuse('filing_gap', `RadCore files from ${start}`);
  if (f.month > start && (await live(before)).length === 0) refuse('filing_gap', `Mark ${before} filed first`);
  const snapshot = { return: f.return, month: f.month, lines: await gstLinesOf(ctx, first, last) };
  const [row] = await tx.insert(gstFilings).values({ return: f.return, month: first, arn: f.arn, filedOn: f.filedOn, snapshot,
    snapshotSha256: versionHash(snapshot) }).returning({ id: gstFilings.id });
  if (row === undefined) throw new Error('The filing was not saved');
  await setFiledLock(ctx.tx, f.return, last);
  return { id: row.id };
}

/** The snapshot's lines (ADR-009 §5): the month's GST lines summed by document, entry kind and account, in one order. */
async function gstLinesOf(ctx: Ctx, first: string, last: string) {
  const rows = await accountsTx(ctx).select({ sourceTable: journalEntries.sourceTable, sourceId: journalEntries.sourceId, kind: journalLines.entryKind,
    accountId: journalLines.accountId, debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.accountControlKind, 'gst'), gte(journalLines.businessDate, first), lte(journalLines.businessDate, last)))
    .groupBy(journalEntries.sourceTable, journalEntries.sourceId, journalLines.entryKind, journalLines.accountId)
    .orderBy(asc(journalEntries.sourceTable), asc(journalEntries.sourceId), asc(journalLines.entryKind), asc(journalLines.accountId));
  return rows.map((r) => ({ ...r, debit: roundMoney(r.debit ?? '0'), credit: roundMoney(r.credit ?? '0') }));
}

const PAGE_KEY = z.object({ month: z.iso.date(), id: z.uuid() });
/** GET /gst/filings: newest month first, then id. */
export async function filingsPage(ctx: Ctx, input: In<typeof listGstFilings>): Promise<Out<typeof listGstFilings>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await accountsTx(ctx).select().from(gstFilings).where(and(
    input.filter.return === undefined ? undefined : eq(gstFilings.return, input.filter.return),
    after([gstFilings.month, gstFilings.id], key && [key.month, key.id], 'desc'),
  )).orderBy(desc(gstFilings.month), desc(gstFilings.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const principal = await principalsOf(ctx, page.map((r) => r.createdBy));
  const last = page.at(-1);
  return { items: page.map((r) => ({ id: r.id, return: r.return as 'gstr1', month: r.month.slice(0, 7), arn: r.arn, filedOn: r.filedOn,
    snapshotSha256: r.snapshotSha256, markedAt: r.createdAt.toISOString(), markedBy: principal(r.createdBy), undone: r.undoneAt !== null })),
  next: rows.length > input.limit && last ? encodeCursor({ month: last.month, id: last.id }) : null };
}

/** What an undo of a filing may not do (ADR-009 §5), asked and approved alike: undo an undone one, or one with a later
 * live filing of its return (`not_latest_filing`). Answers the filing. */
async function checkUndo(ctx: Ctx, filingId: string) {
  const tx = accountsTx(ctx);
  const [f] = await tx.select().from(gstFilings).where(eq(gstFilings.id, filingId)).limit(1);
  if (f === undefined) return refuse('not_found', 'There’s no such filing');
  if (f.undoneAt !== null) refuse('filing_undone', 'This filing is already undone');
  const [later] = await tx.select({ id: gstFilings.id }).from(gstFilings)
    .where(and(eq(gstFilings.return, f.return), gt(gstFilings.month, f.month), isNull(gstFilings.undoneAt))).limit(1);
  if (later !== undefined) refuse('not_latest_filing', 'Only the latest filing of a return can be undone: undo the later ones first');
  return { id: f.id, month: f.month, return: f.return === 'gstr1' ? 'gstr1' as const : 'gstr3b' as const };
}

/** POST /gst/filings/:id/undo-requests: the request, and its approval asked for (`gst-filing-undo`). */
export async function askToUndoFiling(ctx: Ctx, r: In<typeof askFilingUndo>): Promise<Out<typeof askFilingUndo>> {
  const [lock] = await filedLockRow(ctx).for('share');
  const f = await checkUndo(ctx, r.id);
  const [row] = await accountsTx(ctx).insert(filingUndoRequests).values({ filingId: f.id, reason: r.reason,
    throughWas: (f.return === 'gstr1' ? lock?.gstr1 : lock?.gstr3b) ?? null }).returning({ id: filingUndoRequests.id });
  if (row === undefined) throw new Error('The request was not saved');
  return requestApproval(ctx, filingUndoSpec, row.id);
}

type UndoVersion = { filingId: string; return: string; month: string; reason: string; through: string | null };

/**
 * An undo of a filing (D-06). The version names the return's lock as it stands while the request waits, so one a later
 * filing made stale is refused (`version_changed`); once applied, the lock it moved from, which is what was approved.
 * lockFirst takes the filed-month row FOR UPDATE before the request, so two decisions take turns (ADR-009 §7).
 */
export const filingUndoSpec: ApprovalSpec<UndoVersion> = {
  kind: 'gst-filing-undo',
  table: 'filing_undo_requests',
  async version(ctx, id, { forUpdate }) {
    const tx = accountsTx(ctx);
    const q = tx.select().from(filingUndoRequests).where(eq(filingUndoRequests.id, id)).limit(1);
    const [r] = forUpdate ? await q.for('update') : await q;
    if (r === undefined) return null;
    const [f] = await tx.select({ return: gstFilings.return, month: gstFilings.month }).from(gstFilings).where(eq(gstFilings.id, r.filingId)).limit(1);
    if (f === undefined) return null;
    const [lock] = r.appliedAt === null ? await filedLockRow(ctx) : [];
    const now = (f.return === 'gstr1' ? lock?.gstr1 : lock?.gstr3b) ?? null;
    return { filingId: r.filingId, return: f.return, month: f.month, reason: r.reason, through: r.appliedAt === null ? now : r.throughWas };
  },
  async lockFirst(ctx) {
    await lockPeriodForMove(ctx, 'filed');
  },
  async approved(ctx, id) {
    const tx = accountsTx(ctx);
    const [r] = await tx.select().from(filingUndoRequests).where(eq(filingUndoRequests.id, id)).limit(1);
    if (r === undefined) return refuse('not_found', 'There’s no such request');
    // Judged again under the lock: a later filing may have been marked since it was asked.
    const f = await checkUndo(ctx, r.filingId);
    const [before] = await tx.select({ month: gstFilings.month }).from(gstFilings)
      .where(and(eq(gstFilings.return, f.return), lt(gstFilings.month, f.month), isNull(gstFilings.undoneAt)))
      .orderBy(desc(gstFilings.month)).limit(1);
    await tx.update(gstFilings).set({ undoneAt: new Date() }).where(eq(gstFilings.id, f.id));
    await setFiledLock(ctx.tx, f.return, before === undefined ? null : period(before.month).end);
    await tx.update(filingUndoRequests).set({ appliedAt: new Date() }).where(eq(filingUndoRequests.id, id));
  },
  async rejected() {},
};
