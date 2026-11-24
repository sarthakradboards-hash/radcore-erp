// The chart of accounts and the journal as RAD-86's routes answer them (M2-16's screens; ADR-006 §2, §3). Reads, and
// the engine's own manual journal and reversal: nothing here writes the books except through journal.ts.
import { accounts, accountsTx, after, journalEntries, journalLines } from '@radcore/db/accounts';
import { ACCOUNT_TYPES, CONTROL_KINDS, dec, ENTRY_KINDS, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, principalsOf, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, gte, inArray, lte, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { getJournal, listAccounts, listJournal, postJournal, reverseJournal, setAccount } from '../contract.ts';
import { periodLockRow, postManualJournal, reverseEntry, type Posted } from './journal.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** GET /accounts: every account, by code where it has one, then by name. */
export async function chartOfAccounts(ctx: Ctx): Promise<Out<typeof listAccounts>> {
  const rows = await accountsTx(ctx).select({ id: accounts.id, code: accounts.code, name: accounts.name, systemKey: accounts.systemKey,
    type: accounts.type, controlKind: accounts.controlKind, parentId: accounts.parentId, active: accounts.active }).from(accounts)
    .orderBy(asc(accounts.code), asc(accounts.nameKey), asc(accounts.id));
  return { items: rows.map((a) => ({ ...a, type: z.enum(ACCOUNT_TYPES).parse(a.type),
    controlKind: z.enum(CONTROL_KINDS).parse(a.controlKind), control: a.controlKind !== 'none' })) };
}

/** For the books check (RAD-95, ADR-006 §7): every journal line's debits and credits, as at `asAt` (every line when
 * it's left out). They're equal when the books balance. */
export async function trialBalance(ctx: Ctx, asAt?: string): Promise<{ debit: string; credit: string }> {
  const [row] = await accountsTx(ctx).select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .where(asAt === undefined ? undefined : lte(journalLines.businessDate, asAt));
  return { debit: row?.debit ?? '0', credit: row?.credit ?? '0' };
}

/** For the books check: Stock in Hand per item and place, debits less credits, as at `asAt` (every line when it's left
 * out). A Stock in Hand line always names both (ck_journal_lines_stock_dims). */
export async function stockInHand(ctx: Ctx, asAt?: string): Promise<{ itemId: string; locationId: string; value: string }[]> {
  const rows = await accountsTx(ctx).select({ itemId: journalLines.itemId, locationId: journalLines.locationId,
    debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .where(and(eq(journalLines.accountControlKind, 'stock'), asAt === undefined ? undefined : lte(journalLines.businessDate, asAt)))
    .groupBy(journalLines.itemId, journalLines.locationId);
  return rows.map((r) => ({ itemId: r.itemId ?? '', locationId: r.locationId ?? '',
    value: dec(r.debit ?? '0').minus(dec(r.credit ?? '0')).toString() }));
}

/** For the books check (ADR-006 §7): a system account's debits and credits, as at `asAt` (every line when it's left out). */
export async function systemBalance(ctx: Ctx, key: string, asAt?: string): Promise<{ debit: string; credit: string }> {
  const [row] = await accountsTx(ctx).select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(accounts.systemKey, key), asAt === undefined ? undefined : lte(journalLines.businessDate, asAt)));
  return { debit: row?.debit ?? '0', credit: row?.credit ?? '0' };
}

/** For the books check as at a date (ADR-006 §7): each journal entry's business date, by id. */
export async function entryDates(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await accountsTx(ctx).select({ id: journalEntries.id, date: journalEntries.businessDate }).from(journalEntries)
    .where(inArray(journalEntries.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.date]));
}

/**
 * PATCH /accounts/:id: an account's code, and switching it off or on (the architect on RAD-86). Switching off reads
 * the balance with the period lock's row held FOR UPDATE, ADR-006 §1's step 1: postings hold it FOR SHARE, so the
 * switch waits for those in flight and none lands between the read and the switch.
 */
export async function changeAccount(ctx: Ctx, { id, code, active }: In<typeof setAccount>): Promise<Out<typeof setAccount>> {
  const tx = accountsTx(ctx);
  if (active === false) await periodLockRow(ctx).for('update');
  const [row] = await tx.select({ systemKey: accounts.systemKey }).from(accounts).where(eq(accounts.id, id)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There’s no such account');
  if (active === false) {
    if (row.systemKey !== null) throw new AppError('system_account', 'A system account is never switched off');
    const [held] = await tx.select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
      .where(eq(journalLines.accountId, id));
    if (!dec(held?.debit ?? '0').eq(dec(held?.credit ?? '0'))) {
      throw new AppError('account_not_empty', 'The account still holds a balance: move it to another account first');
    }
  }
  try {
    await tx.update(accounts).set({ ...(code === undefined ? {} : { code }), ...(active === undefined ? {} : { active }) })
      .where(eq(accounts.id, id));
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'ux_accounts_code') {
      throw new AppError('code_taken', 'Another account has this code', [{ path: ['code'], code: 'taken', message: 'Choose another code' }]);
    }
    throw e;
  }
  return {};
}

const entryColumns = {
  id: journalEntries.id, number: journalEntries.number, kind: journalEntries.kind, businessDate: journalEntries.businessDate,
  sourceTable: journalEntries.sourceTable, sourceId: journalEntries.sourceId, reversesEntryId: journalEntries.reversesEntryId,
  reason: journalEntries.reason, postedAt: journalEntries.postedAt, createdBy: journalEntries.createdBy,
};
type EntryRow = { id: string; number: string; kind: string; businessDate: string; sourceTable: string; sourceId: string;
  reversesEntryId: string | null; reason: string | null; postedAt: Date; createdBy: string };

/** How to answer each of `rows`: its total, the entry reversing it and who posted it, in one query each per page. */
async function shownOf(ctx: Ctx, rows: readonly EntryRow[]) {
  const tx = accountsTx(ctx);
  const ids = rows.map((r) => r.id);
  const totals = new Map(ids.length === 0 ? [] : (await tx.select({ id: journalLines.entryId, total: sum(journalLines.debit) })
    .from(journalLines).where(inArray(journalLines.entryId, ids)).groupBy(journalLines.entryId)).map((t) => [t.id, t.total]));
  const reversals = new Map(ids.length === 0 ? [] : (await tx.select({ id: journalEntries.id, of: journalEntries.reversesEntryId })
    .from(journalEntries).where(inArray(journalEntries.reversesEntryId, ids))).map((r) => [r.of, r.id]));
  const principal = await principalsOf(ctx, rows.map((r) => r.createdBy));
  return (r: EntryRow) => ({
    id: r.id, number: r.number, businessDate: r.businessDate, kind: z.enum(ENTRY_KINDS).parse(r.kind),
    source: { table: r.sourceTable, id: r.sourceId }, total: roundMoney(totals.get(r.id) ?? '0'),
    reversesEntryId: r.reversesEntryId, reversedBy: reversals.get(r.id) ?? null, postedAt: r.postedAt.toISOString(),
    postedBy: principal(r.createdBy),
  });
}

/** GET /journal: newest business date first, then number, so a page key is unique and paging never skips or repeats. */
export async function journalPage(ctx: Ctx, input: In<typeof listJournal>): Promise<Out<typeof listJournal>> {
  const key = input.after === undefined ? undefined
    : decodeCursor(z.object({ date: z.iso.date(), number: z.string().max(40) }), input.after);
  const { from, to, kind } = input.filter;
  const rows = await accountsTx(ctx).select(entryColumns).from(journalEntries)
    .where(and(
      from === undefined ? undefined : gte(journalEntries.businessDate, from),
      to === undefined ? undefined : lte(journalEntries.businessDate, to),
      kind === undefined ? undefined : eq(journalEntries.kind, kind),
      after([journalEntries.businessDate, journalEntries.number], key && [key.date, key.number], 'desc'),
    ))
    .orderBy(desc(journalEntries.businessDate), desc(journalEntries.number)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const show = await shownOf(ctx, page);
  return { items: page.map(show),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, number: last.number }) : null };
}

/** GET /journal/:id: the entry, its reason, and its lines with each account's name. */
export async function journalEntryById(ctx: Ctx, { id }: In<typeof getJournal>): Promise<Out<typeof getJournal>> {
  const tx = accountsTx(ctx);
  const [row] = await tx.select(entryColumns).from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There’s no such entry');
  const lines = await tx.select({ lineNo: journalLines.lineNo, accountId: journalLines.accountId, name: accounts.name,
    debit: journalLines.debit, credit: journalLines.credit, partyId: journalLines.partyId, itemId: journalLines.itemId,
    locationId: journalLines.locationId }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, id)).orderBy(asc(journalLines.lineNo));
  return { ...(await shownOf(ctx, [row]))(row), reason: row.reason,
    lines: lines.map(({ accountId, name, debit, credit, ...l }) => ({ ...l, account: { id: accountId, name },
      debit: roundMoney(debit), credit: roundMoney(credit) })) };
}

/** POST /journal: a manual journal, through the engine (ordinary accounts only, balanced, in an open period). */
export function postManual(ctx: Ctx, j: In<typeof postJournal>): Promise<Posted> {
  return postManualJournal(ctx, { businessDate: j.businessDate, reason: j.reason, lines: j.lines.map((l) => ({
    account: { id: l.accountId }, ...(l.debit === undefined ? {} : { debit: l.debit }), ...(l.credit === undefined ? {} : { credit: l.credit }),
  })) });
}

/** POST /journal/:id/reverse: the engine's reversal of a manual journal, dated `businessDate`, with the reason. A
 * document's entry is reversed by cancelling the document (ADR-006 §3), which keeps the two in step: reversed here, the
 * document would stay posted and its own cancel would then fail (the auditor on #207). */
export async function reverseJournalEntry(ctx: Ctx, r: In<typeof reverseJournal>): Promise<Posted> {
  const [entry] = await accountsTx(ctx).select({ kind: journalEntries.kind }).from(journalEntries)
    .where(eq(journalEntries.id, r.id)).limit(1);
  if (entry === undefined) throw new AppError('not_found', 'There’s no such entry');
  if (entry.kind !== 'manual') {
    throw new AppError('reverse_through_document', 'This entry belongs to a document: cancel the document to reverse it');
  }
  return reverseEntry(ctx, { entryId: r.id, businessDate: r.businessDate, reason: r.reason });
}
