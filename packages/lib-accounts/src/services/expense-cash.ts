// One supplier's cash paid out on one day (ADR-007 §8, section 40A(3); ADR-009 §3; the architect on #435): every posted
// cash payment, refund and cash expense to them, whoever entered it, for the day's cash-payment limit. Payments and
// expenses both judge their limit by this one sum, so neither can stay under it by the other's door. It reads past the
// record scope (ADR-001 §6a) and answers one sum, never rows.
import { accounts, accountsTx, expenses, payments } from '@radcore/db/accounts';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray, ne } from 'drizzle-orm';

/** The posted cash paid to `partyId` on `businessDate`, by payment or refund and by expense, less the one record being
 * judged (`not`). The caller holds the party's row first (holdParty, ADR-006 §1 step 3), so two saves take turns. */
export async function cashPaidOn(ctx: Ctx, partyId: string, businessDate: string, not: { payment?: string; expense?: string } = {}): Promise<Decimal> {
  const tx = accountsTx(ctx);
  const cash = tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.systemKey, 'cash'));
  const paid = await tx.select({ amount: payments.amount }).from(payments).where(and(eq(payments.partyId, partyId),
    eq(payments.businessDate, businessDate), eq(payments.status, 'posted'), inArray(payments.accountId, cash), inArray(payments.kind, ['payment', 'refund']),
    not.payment === undefined ? undefined : ne(payments.id, not.payment)));
  const spent = await tx.select({ amount: expenses.statedTotal }).from(expenses).where(and(eq(expenses.partyId, partyId),
    eq(expenses.businessDate, businessDate), eq(expenses.status, 'posted'), inArray(expenses.payFromAccountId, cash),
    not.expense === undefined ? undefined : ne(expenses.id, not.expense)));
  return [...paid, ...spent].reduce((s, r) => s.plus(dec(r.amount)), dec('0'));
}
