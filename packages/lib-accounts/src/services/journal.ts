// The journal engine (M2-03, RAD-86; ADR-006 §1–§3, ADR-005 §2, §6, §7). The books are only posted and reversed:
// there's no edit and no delete, and the database refuses both (RA001). A document's service posts its entry inside
// the save's one transaction, in ADR-006 §1's lock order: the period lock FOR SHARE first, then (the caller's) the
// documents, and the entry's number last, once every check has passed. The database checks again what the engine
// checks (balance at commit RA002, the period lock RA003, control accounts by their posting rules), so a service
// that skipped the engine couldn't post a wrong entry either.
import { accounts, accountsTx, financialYears, journalEntries, journalLines, periodLock } from '@radcore/db/accounts';
import { dec, financialYear, roundMoney, sum, type EntryKind, type Money } from '@radcore/lib-common';
import { AppError, defineSeries, nextNumber, type Ctx } from '@radcore/lib-platform';
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, or } from 'drizzle-orm';

/** The journal's numbering series (RAD-87): "JV/26-27/0000042". Nearly every document posts an entry, so it has 7 digits,
 * where a document series under Rule 46 has 5 (the architect on #171). */
export const JOURNAL_SERIES = defineSeries('accounts.journal', 'JV', { digits: 7 });

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

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
const amountOf = (l: JournalLine): { debit: Money; credit: Money } => {
  const debit = roundMoney(l.debit ?? '0');
  const credit = roundMoney(l.credit ?? '0');
  if (dec(debit).gt(0) === dec(credit).gt(0)) refuse('invalid_line', 'Each line is a debit or a credit above zero, not both');
  if (dec(debit).lt(0) || dec(credit).lt(0)) refuse('invalid_line', 'A debit or credit is never below zero');
  return { debit, credit };
};

/** Opens a financial year by its 1 April, so entries can be dated in it (ADR-005 §6). Opening one twice is a no-op. */
export async function openFinancialYear(ctx: Ctx, date: string): Promise<void> {
  await accountsTx(ctx).insert(financialYears).values({ start: financialYear(date).start }).onConflictDoNothing();
}

async function write(ctx: Ctx, e: { kind: EntryKind; businessDate: string; source: { table: string; id: string };
  lines: readonly JournalLine[]; reason?: string; reverses?: string; id?: string }): Promise<Posted> {
  const tx = accountsTx(ctx);
  if (e.lines.length < 2) refuse('unbalanced', 'An entry has two lines or more');
  const amounts = e.lines.map(amountOf);
  if (!sum(amounts.map((a) => a.debit)).eq(sum(amounts.map((a) => a.credit)))) {
    refuse('unbalanced', 'The debits and credits differ');
  }
  // 1. The period lock, FOR SHARE: moving it waits for this posting, and this one sees where it stands (RC-163).
  const [lock] = await tx.select({ through: periodLock.lockedThrough }).from(periodLock).where(eq(periodLock.id, 1)).for('share');
  if (lock?.through !== null && lock?.through !== undefined && e.businessDate <= lock.through) {
    refuse('period_locked', `The books are locked through ${lock.through}`);
  }
  // Every line's account and control kind in one read.
  const ids = e.lines.flatMap((l) => ('id' in l.account ? [l.account.id] : []));
  const keys = e.lines.flatMap((l) => ('system' in l.account ? [l.account.system] : []));
  const found = await tx.select({ id: accounts.id, systemKey: accounts.systemKey, control: accounts.controlKind }).from(accounts)
    .where(or(ids.length > 0 ? inArray(accounts.id, ids) : undefined, keys.length > 0 ? inArray(accounts.systemKey, keys) : undefined));
  const of = (ref: AccountRef) => found.find((a) => ('id' in ref ? a.id === ref.id : a.systemKey === ref.system))
    ?? refuse('unknown_account', `There's no account ${'id' in ref ? ref.id : ref.system}`);
  const resolved = e.lines.map((l) => of(l.account));
  // A manual journal touches ordinary accounts only (RC-093); the database's posting rules hold every other kind.
  if (e.kind === 'manual' && resolved.some((a) => a.control !== 'none')) {
    refuse('control_account', 'A manual journal can’t post to GST, TDS, GRNI, payroll or another control account');
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
  if (original.kind === 'manual' && (r.reason ?? '') === '') refuse('reason_required', 'Say why the journal is reversed');
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, original.id)).orderBy(asc(journalLines.lineNo));
  return write(ctx, {
    kind: original.kind as EntryKind, businessDate: r.businessDate, reverses: original.id,
    source: { table: original.sourceTable, id: original.sourceId }, ...(r.reason === undefined ? {} : { reason: r.reason }),
    lines: lines.map((l) => ({ account: { id: l.accountId }, debit: roundMoney(l.credit), credit: roundMoney(l.debit),
      ...(l.partyId === null ? {} : { partyId: l.partyId }), ...(l.itemId === null ? {} : { itemId: l.itemId }),
      ...(l.locationId === null ? {} : { locationId: l.locationId }) })),
  });
}
