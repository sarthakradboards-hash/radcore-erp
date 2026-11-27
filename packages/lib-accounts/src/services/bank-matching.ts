// Matching bank statement lines to the books (M5-13, RAD-165; ADR-009 §12; RC-087, RC-145, RC-210). A match joins one
// or more statement lines and one or more journal lines on one bank account whose signed totals agree; the database
// checks that at commit (`match_unbalanced`). Amount and date alone never make one: a line's candidates are ranked by
// reference, then the party's name in the narration, then the nearest date, and the person picks.
//   match: lockPeriod -> the posting documents FOR SHARE, by table then id -> the statement lines FOR UPDATE, by id
// A cancel takes its document FOR UPDATE, so a match and a cancel of one document take turns (`bank_matched`).
import {
  accounts, accountsTx, after, bankMatches, bankMatchJournalLines, bankMatchStatementLines, bankStatementLines, expenses, journalEntries, journalLines, parties,
  payments, transfers,
} from '@radcore/db/accounts';
import { addDays, dec, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSetting, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, between, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, not, or } from 'drizzle-orm';
import { z } from 'zod';
import type { listBookLinesContract, listMatchCandidatesContract, matchLinesContract, unmatchContract } from '../contract-bank.ts';
import { lockPeriod } from './journal.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const refuse = (code: string, message: string): never => { throw new AppError(code, message); };

/** ADR-009 §12's bank.match_days (a setting's key names its module): how far either side of a bank line's value date a book line may be dated to be its candidate. */
export const MATCH_DAYS = defineSetting('accounts.bank_match_days', z.number().int().min(0).max(60), 5, {
  label: 'Days a bank match may span',
  description: 'How many days either side of a bank statement line’s date a book entry may be dated and still be offered as its match.',
  input: { kind: 'integer' },
});

/** A bank account: Bank itself, or an account under it (ADR-009 §11). Cash, a party's or any other account is refused. */
export async function bankAccount(ctx: Ctx, id: string): Promise<void> {
  const tx = accountsTx(ctx);
  const [a] = await tx.select({ key: accounts.systemKey, parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, id)).limit(1);
  const [parent] = a?.parentId == null ? [] : await tx.select({ key: accounts.systemKey }).from(accounts).where(eq(accounts.id, a.parentId)).limit(1);
  if (a === undefined || !(a.key === 'bank' || parent?.key === 'bank')) refuse('not_a_bank_account', 'Pick a bank account under Bank');
}

/** Refuses with `bank_matched` when a line of the entry is matched to the bank statement: a document's cancel calls it
 * with its row already locked FOR UPDATE, so a match of the same document waits for the cancel or is seen by it. */
export async function refuseIfMatched(ctx: Ctx, entryId: string): Promise<void> {
  const [hit] = await accountsTx(ctx).select({ id: bankMatchJournalLines.matchId }).from(bankMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankMatchJournalLines.journalLineId)).where(eq(journalLines.entryId, entryId)).limit(1);
  if (hit !== undefined) refuse('bank_matched', 'This is matched to the bank statement: unmatch it first');
}

// The documents that post to a bank account, by table: each locked FOR SHARE before a match (ADR-009 §12). A manual
// journal's entry is its own document and never changes, so it needs no lock.
const SOURCES = { payments, transfers, expenses } as const;
const isSource = (t: string): t is keyof typeof SOURCES => t in SOURCES;

const signedOf = (l: { direction: string; amount: string }) => (l.direction === 'in' ? dec(l.amount) : dec(l.amount).neg());

/** Which of these entries are reversed or are reversals: never matched (`entry_reversed`). */
async function deadEntries(ctx: Ctx, entries: readonly { id: string; reversesEntryId: string | null }[]): Promise<Set<string>> {
  const ids = entries.map((e) => e.id);
  const reversed = ids.length === 0 ? [] : await accountsTx(ctx).select({ of: journalEntries.reversesEntryId }).from(journalEntries)
    .where(inArray(journalEntries.reversesEntryId, ids));
  return new Set([...entries.filter((e) => e.reversesEntryId !== null).map((e) => e.id), ...reversed.flatMap((r) => (r.of === null ? [] : [r.of]))]);
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** GET /bank/statement-lines/:id/candidates: the unmatched live book lines on the line's account of its signed amount,
 * dated within bank.match_days, ranked (ADR-009 §12). */
export async function matchCandidates(ctx: Ctx, { id }: In<typeof listMatchCandidatesContract>): Promise<Out<typeof listMatchCandidatesContract>> {
  const tx = accountsTx(ctx);
  const [line] = await tx.select().from(bankStatementLines).where(eq(bankStatementLines.id, id)).limit(1);
  if (line === undefined) return refuse('not_found', 'There’s no such statement line');
  const days = ctx.settings.get(MATCH_DAYS);
  const amount = roundMoney(line.amount);
  const rows = await tx.select({ id: journalLines.id, entryId: journalLines.entryId, date: journalLines.businessDate, debit: journalLines.debit,
    credit: journalLines.credit, number: journalEntries.number, kind: journalEntries.kind, sourceTable: journalEntries.sourceTable,
    sourceId: journalEntries.sourceId, reversesEntryId: journalEntries.reversesEntryId, matched: bankMatchJournalLines.matchId })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(bankMatchJournalLines, eq(bankMatchJournalLines.journalLineId, journalLines.id))
    .where(and(eq(journalLines.accountId, line.accountId), line.direction === 'in' ? eq(journalLines.debit, amount) : eq(journalLines.credit, amount),
      between(journalLines.businessDate, addDays(line.valueDate, -days), addDays(line.valueDate, days)), isNull(bankMatchJournalLines.matchId)))
    .orderBy(asc(journalLines.businessDate), asc(journalLines.id)).limit(200);
  const dead = await deadEntries(ctx, rows.map((r) => ({ id: r.entryId, reversesEntryId: r.reversesEntryId })));
  const open = rows.filter((r) => !dead.has(r.entryId) && r.matched === null);
  const docs = await documentsOf(ctx, open.map((r) => ({ table: r.sourceTable, id: r.sourceId })));
  const narration = ` ${words(line.narration)} `;
  const ref = line.reference.trim().toLowerCase();
  const ranked = open.map((r) => {
    const doc = docs.get(`${r.sourceTable}:${r.sourceId}`);
    const docRef = doc?.reference?.trim().toLowerCase() ?? '';
    const byReference = docRef !== '' && (docRef === ref || narration.includes(` ${words(docRef)} `));
    const name = doc?.party === undefined || doc.party === null ? '' : words(doc.party);
    const byParty = name === '' ? null : narration.includes(` ${name} `) ? 'whole' as const
      : name.split(' ').some((w) => w.length >= 5 && narration.includes(` ${w} `)) ? 'word' as const : null;
    const apart = Math.abs((Date.parse(r.date) - Date.parse(line.valueDate)) / 86_400_000);
    return { journalLineId: r.id, entryId: r.entryId, entryNumber: r.number, kind: r.kind, businessDate: r.date,
      source: { table: r.sourceTable, id: r.sourceId }, reference: doc?.reference ?? null, party: doc?.party ?? null,
      byReference, byParty, daysApart: apart };
  });
  const rank = (c: (typeof ranked)[number]) => (c.byReference ? 4 : 0) + (c.byParty === 'whole' ? 2 : c.byParty === 'word' ? 1 : 0);
  ranked.sort((a, b) => rank(b) - rank(a) || a.daysApart - b.daysApart || a.journalLineId.localeCompare(b.journalLineId));
  return { candidates: ranked.slice(0, 50) };
}

/** Each posting document's reference and party name, where its kind has them (payments, transfers). */
async function documentsOf(ctx: Ctx, refs: readonly { table: string; id: string }[]) {
  const tx = accountsTx(ctx);
  const of = (table: string) => [...new Set(refs.filter((r) => r.table === table).map((r) => r.id))];
  const out = new Map<string, { reference: string | null; party: string | null }>();
  const paid = of('payments');
  if (paid.length > 0) {
    for (const p of await tx.select({ id: payments.id, reference: payments.reference, party: parties.name }).from(payments)
      .innerJoin(parties, eq(parties.id, payments.partyId)).where(inArray(payments.id, paid))) out.set(`payments:${p.id}`, p);
  }
  const moved = of('transfers');
  if (moved.length > 0) {
    for (const t of await tx.select({ id: transfers.id, reference: transfers.reference }).from(transfers).where(inArray(transfers.id, moved))) {
      out.set(`transfers:${t.id}`, { reference: t.reference, party: null });
    }
  }
  // shortcut: an expense ranks by date alone. Its party would be read across expenses' own scope (E7) under bank:read;
  // add it with a scope ruling if bank charges by name prove common.
  return out;
}

/** POST /bank/matches: the lines checked under ADR-009 §12's locks, then the match and its links. */
export async function matchLines(ctx: Ctx, m: In<typeof matchLinesContract>): Promise<Out<typeof matchLinesContract>> {
  const tx = accountsTx(ctx);
  await lockPeriod(ctx);
  const books = await tx.select({ id: journalLines.id, accountId: journalLines.accountId, entryId: journalLines.entryId, debit: journalLines.debit,
    credit: journalLines.credit, sourceTable: journalEntries.sourceTable, sourceId: journalEntries.sourceId,
    reversesEntryId: journalEntries.reversesEntryId }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(inArray(journalLines.id, [...new Set(m.journalLineIds)]));
  if (books.length !== new Set(m.journalLineIds).size) refuse('not_found', 'A book line here doesn’t exist');
  // The posting documents FOR SHARE, by table then id, so a cancel in flight finishes first or waits for this match.
  for (const table of [...new Set(books.map((b) => b.sourceTable))].toSorted()) {
    if (!isSource(table)) continue;
    const t = SOURCES[table];
    await tx.select({ id: t.id }).from(t).where(inArray(t.id, books.filter((b) => b.sourceTable === table).map((b) => b.sourceId)))
      .orderBy(asc(t.id)).for('share');
  }
  const dead = await deadEntries(ctx, books.map((b) => ({ id: b.entryId, reversesEntryId: b.reversesEntryId })));
  if (books.some((b) => dead.has(b.entryId))) refuse('entry_reversed', 'A book line here belongs to a cancelled or reversing entry');
  const bank = await tx.select().from(bankStatementLines).where(inArray(bankStatementLines.id, [...new Set(m.statementLineIds)]))
    .orderBy(asc(bankStatementLines.id)).for('update');
  if (bank.length !== new Set(m.statementLineIds).size) refuse('not_found', 'A statement line here doesn’t exist');
  const accountId = bank[0]?.accountId ?? '';
  if ([...bank, ...books].some((l) => l.accountId !== accountId)) refuse('not_this_account', 'A match joins lines of one bank account');
  const taken = [
    ...await tx.select({ id: bankMatchStatementLines.statementLineId }).from(bankMatchStatementLines)
      .where(inArray(bankMatchStatementLines.statementLineId, bank.map((b) => b.id))),
    ...await tx.select({ id: bankMatchJournalLines.journalLineId }).from(bankMatchJournalLines)
      .where(inArray(bankMatchJournalLines.journalLineId, books.map((b) => b.id))),
  ];
  if (taken.length > 0) refuse('already_matched', 'A line here is already matched: unmatch it first');
  const bankTotal = bank.reduce((s, l) => s.plus(signedOf(l)), dec('0'));
  const bookTotal = books.reduce((s, l) => s.plus(dec(l.debit)).minus(dec(l.credit)), dec('0'));
  if (!bankTotal.eq(bookTotal)) {
    refuse('match_unbalanced', `The statement lines come to ${roundMoney(bankTotal)} and the book lines to ${roundMoney(bookTotal)}`);
  }
  const [row] = await tx.insert(bankMatches).values({ accountId, kind: 'manual' }).returning({ id: bankMatches.id });
  if (row === undefined) throw new Error('The match was not saved');
  // Each side's links in id order, so two overlapping matches meet the unique indexes in one order (auditor-2 on #454).
  await tx.insert(bankMatchStatementLines).values(bank.map((b) => b.id).toSorted().map((statementLineId) => ({ matchId: row.id, statementLineId })));
  await tx.insert(bankMatchJournalLines).values(books.map((b) => b.id).toSorted().map((journalLineId) => ({ matchId: row.id, journalLineId })));
  return { id: row.id };
}

/** POST /bank/matches/:id/unmatch: the links deleted (audited) and the match stamped, at any time: a match touches no
 * ledger row, so the period lock doesn't stop it (ADR-009 §12). */
export async function unmatch(ctx: Ctx, { id, reason }: In<typeof unmatchContract>): Promise<Out<typeof unmatchContract>> {
  const tx = accountsTx(ctx);
  const [match] = await tx.select({ unmatchedAt: bankMatches.unmatchedAt }).from(bankMatches).where(eq(bankMatches.id, id)).limit(1).for('update');
  if (match === undefined) return refuse('not_found', 'There’s no such match');
  if (match.unmatchedAt !== null) refuse('not_matched', 'This match is already undone');
  await tx.delete(bankMatchStatementLines).where(eq(bankMatchStatementLines.matchId, id));
  await tx.delete(bankMatchJournalLines).where(eq(bankMatchJournalLines.matchId, id));
  await tx.update(bankMatches).set({ unmatchedAt: new Date(), unmatchReason: reason }).where(eq(bankMatches.id, id));
  return {};
}

/** Which of these statement lines are matched, and to which match: for the lines list, the imports list and undo. */
export async function matchesOfLines(ctx: Ctx, lineIds: readonly string[]): Promise<Map<string, string>> {
  if (lineIds.length === 0) return new Map();
  const rows = await accountsTx(ctx).select({ line: bankMatchStatementLines.statementLineId, match: bankMatchStatementLines.matchId })
    .from(bankMatchStatementLines).where(inArray(bankMatchStatementLines.statementLineId, [...lineIds]));
  return new Map(rows.map((r) => [r.line, r.match]));
}

/** GET /bank/accounts/:id/book-lines: newest first, then by id, so a page key is unique. Live entries only (neither
 * reversed nor a reversal) and none already matched, filtered in the one read. */
export async function bookLinesPage(ctx: Ctx, input: In<typeof listBookLinesContract>): Promise<Out<typeof listBookLinesContract>> {
  const { id } = input;
  const { from, to, direction, amount } = input.filter;
  await bankAccount(ctx, id);
  const tx = accountsTx(ctx);
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ date: z.iso.date(), id: z.uuid() }), input.after);
  const rows = await tx.select({ id: journalLines.id, entryId: journalLines.entryId, date: journalLines.businessDate, debit: journalLines.debit,
    credit: journalLines.credit, number: journalEntries.number, kind: journalEntries.kind, sourceTable: journalEntries.sourceTable,
    sourceId: journalEntries.sourceId }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, id), isNull(journalEntries.reversesEntryId),
      // NOT IN over subqueries that hold no null (notInArray isn't L1's: an empty list means every row).
      not(inArray(journalEntries.id, tx.select({ id: journalEntries.reversesEntryId }).from(journalEntries).where(isNotNull(journalEntries.reversesEntryId)))),
      not(inArray(journalLines.id, tx.select({ id: bankMatchJournalLines.journalLineId }).from(bankMatchJournalLines))),
      from === undefined ? undefined : gte(journalLines.businessDate, from), to === undefined ? undefined : lte(journalLines.businessDate, to),
      direction === undefined ? undefined : direction === 'in' ? gt(journalLines.debit, '0') : gt(journalLines.credit, '0'),
      amount === undefined ? undefined : direction === 'out' ? eq(journalLines.credit, amount)
        : direction === 'in' ? eq(journalLines.debit, amount) : or(eq(journalLines.debit, amount), eq(journalLines.credit, amount)),
      after([journalLines.businessDate, journalLines.id], key && [key.date, key.id], 'desc')))
    .orderBy(desc(journalLines.businessDate), desc(journalLines.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const docs = await documentsOf(ctx, page.map((r) => ({ table: r.sourceTable, id: r.sourceId })));
  return {
    items: page.map((r) => {
      const doc = docs.get(`${r.sourceTable}:${r.sourceId}`);
      const into = dec(r.debit).gt(0);
      return { journalLineId: r.id, entryId: r.entryId, entryNumber: r.number, kind: r.kind, businessDate: r.date, direction: into ? 'in' : 'out',
        amount: roundMoney(into ? r.debit : r.credit), source: { table: r.sourceTable, id: r.sourceId }, reference: doc?.reference ?? null,
        party: doc?.party ?? null };
    }),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.date, id: last.id }) : null,
  };
}
