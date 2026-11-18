// The chart of accounts and the journal as RAD-86's routes answer them (M2-16's screens; ADR-006 §2, §3). Reads, and
// the engine's own manual journal and reversal: nothing here writes the books except through journal.ts.
import { accounts, accountsTx, after, journalEntries, journalLines } from '@radcore/db/accounts';
import { ACCOUNT_TYPES, CONTROL_KINDS, ENTRY_KINDS, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, principalsOf, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, gte, inArray, lte, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { getJournal, listAccounts, listJournal, postJournal, reverseJournal } from '../contract.ts';
import { postManualJournal, reverseEntry, type Posted } from './journal.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** GET /accounts: every account, by name. */
export async function chartOfAccounts(ctx: Ctx): Promise<Out<typeof listAccounts>> {
  const rows = await accountsTx(ctx).select({ id: accounts.id, name: accounts.name, systemKey: accounts.systemKey, type: accounts.type,
    controlKind: accounts.controlKind, parentId: accounts.parentId }).from(accounts).orderBy(asc(accounts.nameKey), asc(accounts.id));
  return { items: rows.map((a) => ({ ...a, type: z.enum(ACCOUNT_TYPES).parse(a.type),
    controlKind: z.enum(CONTROL_KINDS).parse(a.controlKind), control: a.controlKind !== 'none' })) };
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

/** POST /journal/:id/reverse: the engine's reversal, dated `businessDate`, with the reason. */
export function reverseJournalEntry(ctx: Ctx, r: In<typeof reverseJournal>): Promise<Posted> {
  return reverseEntry(ctx, { entryId: r.id, businessDate: r.businessDate, reason: r.reason });
}
