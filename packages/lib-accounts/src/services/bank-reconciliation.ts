// The bank reconciliation statement (M5-13, RAD-165; ADR-009 §12; GL-132): for a bank account and a date, the book
// balance, the statement's balance, and between them the book lines the bank hasn't shown by then and the bank lines
// the books haven't, each listed. As at the date, a match has cleared only when none of its lines on either side is
// dated after it; until then its lines dated by then are outstanding on each side. A cancelled document and its
// reversal net to nothing, so neither is listed.
//   statement balance = book balance - book lines outstanding + bank lines outstanding (+ what's unexplained)
import { accountsTx, bankMatchJournalLines, bankMatchStatementLines, bankStatementLines, journalEntries, journalLines } from '@radcore/db/accounts';
import { dec, roundMoney } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, not, sum, type Column } from 'drizzle-orm';
import type { z } from 'zod';
import type { reconciliationContract } from '../contract-bank.ts';
import { bankAccount } from './bank-matching.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

// Each list shows at most this many lines; its count and total are always whole.
const SHOWN = 500;

/** GET /bank/accounts/:id/reconciliation: the statement as at `asAt`. */
export async function reconciliation(ctx: Ctx, { id, asAt }: In<typeof reconciliationContract>): Promise<Out<typeof reconciliationContract>> {
  await bankAccount(ctx, id);
  const tx = accountsTx(ctx);
  const [books] = await tx.select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .where(and(eq(journalLines.accountId, id), lte(journalLines.businessDate, asAt)));
  const bookBalance = dec(books?.debit ?? '0').minus(dec(books?.credit ?? '0'));
  const [last] = await tx.select({ balance: bankStatementLines.balance }).from(bankStatementLines)
    .where(and(eq(bankStatementLines.accountId, id), lte(bankStatementLines.valueDate, asAt)))
    .orderBy(desc(bankStatementLines.valueDate), desc(bankStatementLines.seq)).limit(1);

  // Matches not yet cleared as at the date: a line on either side dated after it (auditor-2 on #464).
  const lateInBank = tx.select({ id: bankMatchStatementLines.matchId }).from(bankMatchStatementLines)
    .innerJoin(bankStatementLines, eq(bankStatementLines.id, bankMatchStatementLines.statementLineId)).where(gt(bankStatementLines.valueDate, asAt));
  const lateInBooks = tx.select({ id: bankMatchJournalLines.matchId }).from(bankMatchJournalLines)
    .innerJoin(journalLines, eq(journalLines.id, bankMatchJournalLines.journalLineId)).where(gt(journalLines.businessDate, asAt));
  const cleared = (matchId: Column) =>
    and(not(inArray(matchId, lateInBank)), not(inArray(matchId, lateInBooks)));
  // Cancelled documents: the entries reversed by then, and the reversals themselves.
  const reversed = tx.select({ id: journalEntries.reversesEntryId }).from(journalEntries)
    .where(and(isNotNull(journalEntries.reversesEntryId), lte(journalEntries.businessDate, asAt)));
  const bookOutstanding = and(eq(journalLines.accountId, id), lte(journalLines.businessDate, asAt), isNull(journalEntries.reversesEntryId),
    not(inArray(journalEntries.id, reversed)),
    not(inArray(journalLines.id, tx.select({ id: bankMatchJournalLines.journalLineId }).from(bankMatchJournalLines)
      .where(cleared(bankMatchJournalLines.matchId)))));
  const bankOutstanding = and(eq(bankStatementLines.accountId, id), lte(bankStatementLines.valueDate, asAt),
    not(inArray(bankStatementLines.id, tx.select({ id: bankMatchStatementLines.statementLineId }).from(bankMatchStatementLines)
      .where(cleared(bankMatchStatementLines.matchId)))));

  const bookLines = await tx.select({ id: journalLines.id, entryId: journalLines.entryId, number: journalEntries.number, kind: journalEntries.kind,
    date: journalLines.businessDate, debit: journalLines.debit, credit: journalLines.credit }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).where(bookOutstanding)
    .orderBy(asc(journalLines.businessDate), asc(journalLines.id)).limit(SHOWN);
  const [bookTotal] = await tx.select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit), n: count() }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).where(bookOutstanding);
  const bankLines = await tx.select({ id: bankStatementLines.id, date: bankStatementLines.valueDate, narration: bankStatementLines.narration,
    reference: bankStatementLines.reference, direction: bankStatementLines.direction, amount: bankStatementLines.amount })
    .from(bankStatementLines).where(bankOutstanding).orderBy(asc(bankStatementLines.valueDate), asc(bankStatementLines.seq)).limit(SHOWN);
  const bankRows = await tx.select({ direction: bankStatementLines.direction, total: sum(bankStatementLines.amount), n: count() })
    .from(bankStatementLines).where(bankOutstanding).groupBy(bankStatementLines.direction);

  const bookSigned = dec(bookTotal?.debit ?? '0').minus(dec(bookTotal?.credit ?? '0'));
  const bankSigned = bankRows.reduce((s, r) => (r.direction === 'in' ? s.plus(dec(r.total ?? '0')) : s.minus(dec(r.total ?? '0'))), dec('0'));
  const statementBalance = last === undefined ? null : dec(last.balance);
  return {
    asAt,
    bookBalance: roundMoney(bookBalance),
    statementBalance: statementBalance === null ? null : roundMoney(statementBalance),
    notInBank: {
      count: bookTotal?.n ?? 0, total: roundMoney(bookSigned),
      lines: bookLines.map((l) => ({ journalLineId: l.id, entryId: l.entryId, entryNumber: l.number, kind: l.kind, businessDate: l.date,
        direction: dec(l.debit).gt(0) ? 'in' as const : 'out' as const, amount: roundMoney(dec(l.debit).gt(0) ? l.debit : l.credit) })),
    },
    notInBooks: {
      count: bankRows.reduce((n, r) => n + r.n, 0), total: roundMoney(bankSigned),
      lines: bankLines.map((l) => ({ statementLineId: l.id, valueDate: l.date, narration: l.narration, reference: l.reference,
        direction: l.direction === 'in' ? 'in' as const : 'out' as const, amount: roundMoney(l.amount) })),
    },
    // What the outstanding lines don't explain: the bank's opening balance before the books began, or a line not yet in.
    unexplained: statementBalance === null ? null : roundMoney(statementBalance.minus(bookBalance.minus(bookSigned).plus(bankSigned))),
  };
}
