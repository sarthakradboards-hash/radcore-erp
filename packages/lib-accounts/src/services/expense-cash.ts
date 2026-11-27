// The cash a supplier was paid through expenses on one day (ADR-007 §8, section 40A(3)), for an expense's cash limit:
// every posted cash expense counts, whoever entered it, so it reads past the record scope and answers one sum.
import { accounts, accountsTx, expenses } from '@radcore/db/accounts';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray, ne } from 'drizzle-orm';

/** The posted cash expenses of `partyId` dated `businessDate`, leaving out `notId`, summed. */
export async function cashExpensedOn(ctx: Ctx, partyId: string, businessDate: string, notId: string): Promise<Decimal> {
  const tx = accountsTx(ctx);
  const cash = tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.systemKey, 'cash'));
  const rows = await tx.select({ amount: expenses.statedTotal }).from(expenses).where(and(eq(expenses.partyId, partyId),
    eq(expenses.businessDate, businessDate), eq(expenses.status, 'posted'), inArray(expenses.payFromAccountId, cash), ne(expenses.id, notId)));
  return rows.reduce((s, r) => s.plus(dec(r.amount)), dec('0'));
}
