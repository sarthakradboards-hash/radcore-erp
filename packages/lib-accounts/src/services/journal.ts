// The journal engine (M2-03, RAD-86; ADR-006 §1–§3, ADR-005 §2, §6, §7). The books are only posted and reversed:
// there's no edit and no delete, and the database refuses both (RA001). A document's service posts its entry inside
// the save's one transaction, in ADR-006 §1's lock order: the period lock FOR SHARE first, then (the caller's) the
// documents, and the entry's number last, once every check has passed. The database checks again what the engine
// checks (balance at commit RA002, the period lock RA003, control accounts by their posting rules), so a service
// that skipped the engine couldn't post a wrong entry either.
import { accounts, accountsTx, company, financialYears, journalEntries, journalLines, periodLock } from '@radcore/db/accounts';
import { financialYear, type EntryKind, type Money } from '@radcore/lib-common';
import { AppError, defineSeries, nextNumber, type Ctx } from '@radcore/lib-platform';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { balancedAmounts, swapSides } from './posting.ts';

/** The journal's numbering series (RAD-87): "JV/26-27/0000042". Nearly every document posts an entry, so it has 7 digits,
 * where a document series under Rule 46 has 5 (the architect on #171). */
export const JOURNAL_SERIES = defineSeries('accounts.journal', 'JV', { digits: 7, label: 'Journal entries' });

/** An account, by its system key (`{ system: 'cash' }`) or, for one people added, its id. */
export type AccountRef = Readonly<{ system: string } | { id: string }>;
/** One side of an entry: exactly one of debit and credit, above zero. */
export type JournalLine = Readonly<{
  account: AccountRef; debit?: Money; credit?: Money; partyId?: string; itemId?: string; locationId?: string;
}>;
export type NewEntry = Readonly<{
  kind: Exclude<EntryKind, 'manual'>; businessDate: string; source: Readonly<{ table: string; id: string }>;
  lines: readonly JournalLine[];
}>;
export type Posted = { id: string; number: string };

// A refusal any caller can meet (a switched-off account, the period lock, an unopened year) must be in every posting
// route's errors: a new one goes into tools/permission-reach.test.ts's ENGINE_ERRORS too, which checks those routes
// (the auditor on #234).
const refuse = (code: string, message: string): never => { throw new AppError(code, message); };

// The company's one period-lock row, for a posting's FOR SHARE (holdPeriod) or a lock move's FOR UPDATE (switching an
// account off, books.ts).
export const periodLockRow = (ctx: Ctx) => accountsTx(ctx).select({ through: periodLock.lockedThrough }).from(periodLock)
  .where(eq(periodLock.id, 1));

/**
 * ADR-006 §1's step 1's locks alone, refusing nothing: the company profile, then the period lock row, FOR SHARE. The
 * profile first, so changing it waits for the postings in flight and the GSTIN and state an invoice freezes can't
 * change under it (the architect on RAD-113); before it's set there's no row. An approval's lockFirst takes these
 * before its record and leaves the checks to its posting (the auditor on #275): a reject must never be refused by
 * them. Answers where the lock stands.
 */
export async function lockPeriod(ctx: Ctx): Promise<string | null> {
  await accountsTx(ctx).select({ id: company.id }).from(company).for('share');
  const [lock] = await periodLockRow(ctx).for('share');
  return lock?.through ?? null;
}

/**
 * ADR-006 §1's step 1, for every posting: the company profile and the period lock read FOR SHARE, so moving it waits for this posting and this
 * one sees where it stands (RC-163), then `period_locked` on or before it and `year_not_open` for a year nobody opened
 * (the database's foreign key holds that too, RC-111). A document's service calls it first, before locking its
 * documents; postEntry and lib-stock's postStock call it again on entry, which costs nothing and keeps every check
 * under the lock (the architect on RAD-93).
 * shortcut: the filed-month lock row (M5-08) joins this read when its table lands.
 */
export async function holdPeriod(ctx: Ctx, businessDate: string): Promise<void> {
  const through = await lockPeriod(ctx);
  if (through !== null && businessDate <= through) refuse('period_locked', `The books are locked through ${through}`);
  await yearOpen(ctx, businessDate);
}

async function yearOpen(ctx: Ctx, businessDate: string): Promise<void> {
  const year = financialYear(businessDate);
  const [open] = await accountsTx(ctx).select({ start: financialYears.start }).from(financialYears)
    .where(eq(financialYears.start, year.start)).limit(1);
  if (open === undefined) refuse('year_not_open', `The financial year ${year.label} isn't open`);
}

/** Opens a financial year by its 1 April, so entries can be dated in it (ADR-005 §6). Opening one twice is a no-op. */
export async function openFinancialYear(ctx: Ctx, date: string): Promise<void> {
  await accountsTx(ctx).insert(financialYears).values({ start: financialYear(date).start }).onConflictDoNothing();
}

async function write(ctx: Ctx, e: { kind: EntryKind; businessDate: string; source: { table: string; id: string };
  lines: readonly JournalLine[]; reason?: string; reverses?: string; id?: string }): Promise<Posted> {
  const tx = accountsTx(ctx);
  // The arithmetic first, before anything is read (posting.ts): each line one side above zero, and the entry balanced.
  const amounts = balancedAmounts(e.lines);
  // 1. The period lock (holdPeriod), again if the document's service already took it: a second FOR SHARE is free. The
  // year-end close and its reversal pass it, dated their year's 31 March and naming their close (ADR-009 §6), as the
  // database's trigger does; it also holds that the close is that year's (auditor-2 on #426).
  if (e.kind === 'year_close' && e.source.table === 'year_closes' && e.businessDate === financialYear(e.businessDate).end) {
    await lockPeriod(ctx);
    await yearOpen(ctx, e.businessDate);
  } else await holdPeriod(ctx, e.businessDate);
  // Every line's account and control kind in one read.
  const ids = e.lines.flatMap((l) => ('id' in l.account ? [l.account.id] : []));
  const keys = e.lines.flatMap((l) => ('system' in l.account ? [l.account.system] : []));
  const found = await tx.select({ id: accounts.id, systemKey: accounts.systemKey, control: accounts.controlKind, active: accounts.active })
    .from(accounts)
    .where(or(ids.length > 0 ? inArray(accounts.id, ids) : undefined, keys.length > 0 ? inArray(accounts.systemKey, keys) : undefined));
  const of = (ref: AccountRef) => found.find((a) => ('id' in ref ? a.id === ref.id : a.systemKey === ref.system))
    ?? refuse('unknown_account', `There's no account ${'id' in ref ? ref.id : ref.system}`);
  const resolved = e.lines.map((l) => of(l.account));
  // A manual journal touches ordinary accounts only (RC-093); the database's posting rules hold every other kind.
  if (e.kind === 'manual' && resolved.some((a) => a.control !== 'none')) {
    refuse('control_account', 'A manual journal can’t post to GST, TDS, GRNI, payroll or another control account');
  }
  // A switched-off account takes no new postings, but a reversal of an entry already on it and the year-end close
  // (ADR-006 §2); the line trigger refuses the same (RA009).
  if (e.reverses === undefined && e.kind !== 'year_close' && resolved.some((a) => !a.active)) {
    refuse('account_inactive', 'An account here is switched off: switch it on, or post to another');
  }
  // 2. The number, last (ADR-006 §1), so the series' row is held for the shortest time.
  const number = await nextNumber(ctx, JOURNAL_SERIES, e.businessDate);
  const id = e.id ?? randomUUID();
  await tx.insert(journalEntries).values({ id, number, kind: e.kind, businessDate: e.businessDate, sourceTable: e.source.table,
    sourceId: e.source.id, reversesEntryId: e.reverses ?? null, reason: e.reason ?? null });
  await tx.insert(journalLines).values(e.lines.map((l, i) => ({
    entryId: id, lineNo: i + 1, entryKind: e.kind, businessDate: e.businessDate,
    accountId: resolved[i]?.id ?? '', accountControlKind: resolved[i]?.control ?? 'none',
    debit: amounts[i]?.debit ?? '0', credit: amounts[i]?.credit ?? '0',
    partyId: l.partyId ?? null, itemId: l.itemId ?? null, locationId: l.locationId ?? null,
  })));
  return { id, number };
}

/** Posts a document's entry: one per document and kind (the database refuses a second). */
export const postEntry = (ctx: Ctx, entry: NewEntry): Promise<Posted> => write(ctx, entry);

/** A manual journal: ordinary accounts only, with the reason it was made. It is its own document. */
export function postManualJournal(ctx: Ctx, j: Readonly<{ businessDate: string; reason: string; lines: readonly JournalLine[] }>):
  Promise<Posted> {
  const id = randomUUID();
  return write(ctx, { kind: 'manual', businessDate: j.businessDate, source: { table: 'journal_entries', id }, id,
    lines: j.lines, reason: j.reason });
}

/**
 * Reverses an entry (ADR-006 §3, ADR-005 §7b): a new entry of the same kind and document, its lines the original's
 * with debit and credit swapped, line for line, dated `businessDate` (the cancellation's), so the period lock applies
 * to that day. An entry is reversed once; a manual journal's reversal says why, too.
 */
export async function reverseEntry(ctx: Ctx, r: Readonly<{ entryId: string; businessDate: string; reason?: string }>): Promise<Posted> {
  const tx = accountsTx(ctx);
  const [original] = await tx.select().from(journalEntries).where(eq(journalEntries.id, r.entryId)).limit(1);
  if (original === undefined) return refuse('not_found', 'There’s no such entry');
  const [already] = await tx.select({ id: journalEntries.id }).from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, original.id)).limit(1);
  if (already !== undefined) refuse('already_reversed', `Entry ${original.number} is already reversed`);
  // Reversing a reversal would post a cancelled document again: post the document anew instead (the auditor on #203).
  if (original.reversesEntryId !== null) refuse('reversal_not_reversible', `Entry ${original.number} is itself a reversal`);
  if (original.kind === 'manual' && (r.reason ?? '') === '') refuse('reason_required', 'Say why the journal is reversed');
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, original.id)).orderBy(asc(journalLines.lineNo));
  return write(ctx, {
    kind: original.kind as EntryKind, businessDate: r.businessDate, reverses: original.id,
    source: { table: original.sourceTable, id: original.sourceId }, ...(r.reason === undefined ? {} : { reason: r.reason }),
    lines: lines.map((l) => ({ account: { id: l.accountId }, ...swapSides(l),
      ...(l.partyId === null ? {} : { partyId: l.partyId }), ...(l.itemId === null ? {} : { itemId: l.itemId }),
      ...(l.locationId === null ? {} : { locationId: l.locationId }) })),
  });
}

/**
 * A document's cancellation in the books (ADR-006 §3, §6): reverses every entry of the document that isn't a reversal
 * and isn't reversed yet, dated `businessDate`, through reverseEntry: its own entry and any revaluation the stock engine
 * posted for it (F15). The period lock is taken first and the entries read under it, so a posting in flight can't slip
 * one in between. Answers the reversals in the originals' order, the document's own entry first (RAD-114, backend's OK).
 */
export async function reverseEntriesOf(ctx: Ctx, r: Readonly<{ source: Readonly<{ table: string; id: string }>; businessDate: string;
  reason?: string }>): Promise<Posted[]> {
  await holdPeriod(ctx, r.businessDate);
  const all = await accountsTx(ctx).select({ id: journalEntries.id, kind: journalEntries.kind, reverses: journalEntries.reversesEntryId,
    postedAt: journalEntries.postedAt }).from(journalEntries)
    .where(and(eq(journalEntries.sourceTable, r.source.table), eq(journalEntries.sourceId, r.source.id)));
  const reversed = new Set(all.map((e) => e.reverses));
  const open = all.filter((e) => e.reverses === null && !reversed.has(e.id)).toSorted((a, b) =>
    Number(a.kind === 'revaluation') - Number(b.kind === 'revaluation') || a.postedAt.getTime() - b.postedAt.getTime() || a.id.localeCompare(b.id));
  const out: Posted[] = [];
  for (const e of open) out.push(await reverseEntry(ctx, { entryId: e.id, businessDate: r.businessDate, ...(r.reason === undefined ? {} : { reason: r.reason }) }));
  return out;
}

/** Which of these entries post to input GST (RAD-140): a purchase bill claimed its input GST exactly when its entry did
 * (ADR-008 §7a, decided as it posted), so a debit note against it reverses only that, whatever the supplier is now.
 * Answers entry ids only. */
export async function claimedInputGst(ctx: Ctx, entryIds: readonly string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await accountsTx(ctx).select({ id: journalLines.entryId }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(inArray(journalLines.entryId, [...new Set(entryIds)]), inArray(accounts.systemKey, ['input_cgst', 'input_sgst', 'input_igst'])));
  return new Set(rows.map((r) => r.id));
}
