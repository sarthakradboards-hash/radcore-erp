// What a party owes (RAD-111, the architect's ruling): lib-accounts' read for the sales credit checks (lib-sales'
// checkSale). From the party's Debtors lines as at `on`, every kind of posting (bills, receipts, advances, credit
// notes): the net balance, and the oldest bill its credits haven't paid, oldest first (FIFO, until M3-12).
// Worked out in the database, so a long history costs a few sums and the unpaid bills, never every line (M3-33,
// RAD-148): rules/receivable.ts is the same rule over lines, and tools/receivables.test.ts holds the two equal.
import { accounts, accountsTx, journalEntries, journalLines } from '@radcore/db/accounts';
import { dec, roundMoney } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, desc, eq, exists, gt, isNull, lte, not, sum } from 'drizzle-orm';
import type { Receivable } from '../rules/receivable.ts';

// How many unpaid bills each read takes, newest first, while looking for the oldest one.
const PAGE = 200;

/** The party's net Debtors balance as at `on`, and the business date of its oldest unpaid bill (FIFO, until M3-12). */
export async function partyReceivable(ctx: Ctx, partyId: string, on: string): Promise<Receivable> {
  const tx = accountsTx(ctx);
  const debtors = and(eq(accounts.systemKey, 'debtors'), eq(journalLines.partyId, partyId), lte(journalLines.businessDate, on));
  const [all] = await tx.select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(debtors);
  const outstanding = roundMoney(dec(all?.debit ?? '0').minus(dec(all?.credit ?? '0')));
  // A cancelled bill and its reversal leave the FIFO together: a line counts in it when its entry reverses nothing and
  // nothing dated by `on` reverses it (a reversal carries the same Debtors line back, on its own date).
  const reversed = tx.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.reversesEntryId, journalLines.entryId), lte(journalEntries.businessDate, on)));
  const live = and(debtors, isNull(journalEntries.reversesEntryId), not(exists(reversed)));
  const liveLines = () => tx.select({ debit: sum(journalLines.debit), credit: sum(journalLines.credit) }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId)).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId));
  const [counted] = await liveLines().where(live);
  // What the credits leave unpaid of the bills. Paid oldest first, the unpaid ones are the newest: the oldest unpaid
  // bill is the one where the bills after it, summed back from the newest, stop covering what's unpaid.
  const unpaid = dec(counted?.debit ?? '0').minus(dec(counted?.credit ?? '0'));
  if (unpaid.lte(0)) return { outstanding, oldestUnpaid: null };
  let newer = dec('0');
  for (let offset = 0; ; offset += PAGE) {
    const bills = await tx.select({ businessDate: journalLines.businessDate, debit: journalLines.debit }).from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId)).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(live, gt(journalLines.debit, '0')))
      .orderBy(desc(journalLines.businessDate), desc(journalLines.postedAt), desc(journalLines.id)).limit(PAGE).offset(offset);
    for (const bill of bills) {
      newer = newer.plus(dec(bill.debit));
      if (newer.gte(unpaid)) return { outstanding, oldestUnpaid: bill.businessDate };
    }
    // The bills sum to more than is unpaid (credits are never negative), so a bill above always answers before the last
    // page ends (the auditor on #342): running out means the sums and the bills disagree.
    if (bills.length < PAGE) throw new Error(`party ${partyId}: its unpaid ${unpaid.toFixed(2)} is more than its bills`);
  }
}
