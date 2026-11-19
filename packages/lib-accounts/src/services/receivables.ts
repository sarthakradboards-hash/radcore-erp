// What a party owes (RAD-111, the architect's ruling): lib-accounts' read for the sales credit checks (lib-sales'
// checkSale). It reads the party's Debtors lines as at `on`, every kind of posting (bills, receipts, advances, credit
// notes), and rules/receivable.ts nets them and finds the oldest bill they haven't paid.
import { accounts, accountsTx, journalEntries, journalLines } from '@radcore/db/accounts';
import type { Ctx } from '@radcore/lib-platform';
import { and, asc, eq, lte } from 'drizzle-orm';
import { receivable, type Receivable } from '../rules/receivable.ts';

/** The party's net Debtors balance as at `on`, and the business date of its oldest unpaid bill (FIFO, until M3-12). */
export async function partyReceivable(ctx: Ctx, partyId: string, on: string): Promise<Receivable> {
  // Each line's entry, and the entry a reversal reverses, so a cancelled bill and its reversal leave the FIFO together.
  return receivable(await accountsTx(ctx).select({ businessDate: journalLines.businessDate, debit: journalLines.debit,
    credit: journalLines.credit, entryId: journalLines.entryId, reversesEntryId: journalEntries.reversesEntryId }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId)).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(accounts.systemKey, 'debtors'), eq(journalLines.partyId, partyId), lte(journalLines.businessDate, on)))
    .orderBy(asc(journalLines.businessDate), asc(journalLines.postedAt), asc(journalLines.id)));
}
