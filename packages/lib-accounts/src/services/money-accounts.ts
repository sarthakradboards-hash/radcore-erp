// The accounts money moves through (ADR-007 §5; RAD-116): Cash, Bank, or one under Bank, such as a bank account people
// added or the card machine's Card settlements. One rule, for the payment service's check (moneyAccount) and for the
// list a screen offers (GET /money-accounts), so the two never disagree.
import { accounts, accountsTx } from '@radcore/db/accounts';
import type { Ctx } from '@radcore/lib-platform';
import { asc } from 'drizzle-orm';
import type { z } from 'zod';
import type { listMoneyAccounts } from '../contract.ts';

type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** Whether an account takes or pays money: Cash or Bank itself, or one under Bank. Its parent's system key is the caller's. */
export const takesMoney = (a: { key: string | null; parentKey: string | null }): boolean =>
  a.key === 'cash' || a.key === 'bank' || a.parentKey === 'bank';

/** GET /money-accounts (money_accounts:read): each switched-on account a payment may name, by code, then by name, with
 * whether it's cash (the cash limits are its), and no balance. The chart is small, so it's one answer. */
export async function listMoneyAccountsNow(ctx: Ctx): Promise<Out<typeof listMoneyAccounts>> {
  const rows = await accountsTx(ctx).select({ id: accounts.id, code: accounts.code, name: accounts.name, key: accounts.systemKey,
    parentId: accounts.parentId, active: accounts.active }).from(accounts).orderBy(asc(accounts.code), asc(accounts.nameKey), asc(accounts.id));
  const keyOf = new Map(rows.map((r) => [r.id, r.key]));
  return { items: rows.filter((r) => r.active && takesMoney({ key: r.key, parentKey: r.parentId === null ? null : keyOf.get(r.parentId) ?? null }))
    .map((r) => ({ id: r.id, code: r.code, name: r.name, cash: r.key === 'cash' })) };
}
