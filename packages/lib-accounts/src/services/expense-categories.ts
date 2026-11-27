// Expense categories (M5-02, RAD-152; ADR-009 §2, §3): each one's credit rule and the accounts it may post to. The
// database holds those to ordinary expense accounts (the composite key); this names the account a person picked wrong.
import { accounts, accountsTx, expenseCategories, expenseCategoryAccounts, notInNonEmpty } from '@radcore/db/accounts';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { createExpenseCategory, listExpenseCategories, setExpenseCategory } from '../contract-expenses.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const constraintOf = (e: unknown) => (e as { cause?: { constraint?: string } }).cause?.constraint;
const nameTaken = () => new AppError('name_taken', 'Another category has this name', [{ path: ['name'], code: 'taken', message: 'Choose another name' }]);

/** Each picked account must be a switched-on ordinary expense account. */
async function checkAccounts(ctx: Ctx, ids: readonly string[]): Promise<void> {
  const rows = await accountsTx(ctx).select({ id: accounts.id, type: accounts.type, controlKind: accounts.controlKind, active: accounts.active })
    .from(accounts).where(inArray(accounts.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [i, id] of ids.entries()) {
    const a = byId.get(id);
    if (a === undefined || a.type !== 'expense' || a.controlKind !== 'none' || !a.active) {
      const message = 'Pick a switched-on expense account, not a bank, cash, control or income account';
      throw new AppError('not_an_expense_account', message, [{ path: ['accountIds', i], code: 'not_an_expense_account', message }]);
    }
  }
}

export type CategoryPair = Readonly<{ categoryId: string; accountId: string }>;
/** For a document naming a category and one of its accounts (a service bill's charge, RAD-152): each pair as it stands,
 * keyed `category:account`, with the category's credit rule and whether both are switched on; a pair the category
 * doesn't post to is missing. */
export async function categoryPairs(ctx: Ctx, pairs: readonly CategoryPair[]): Promise<Map<string, { blocked: boolean; active: boolean; defaultTds: string | null }>> {
  if (pairs.length === 0) return new Map();
  const rows = await accountsTx(ctx).select({ categoryId: expenseCategoryAccounts.categoryId, accountId: expenseCategoryAccounts.accountId,
    credit: expenseCategories.credit, categoryActive: expenseCategories.active, accountActive: accounts.active,
    defaultTds: expenseCategories.defaultTdsSectionId })
    .from(expenseCategoryAccounts).innerJoin(expenseCategories, eq(expenseCategories.id, expenseCategoryAccounts.categoryId))
    .innerJoin(accounts, eq(accounts.id, expenseCategoryAccounts.accountId))
    .where(inArray(expenseCategoryAccounts.categoryId, [...new Set(pairs.map((p) => p.categoryId))]));
  return new Map(rows.map((r) => [`${r.categoryId}:${r.accountId}`, { blocked: r.credit === 'blocked', active: r.categoryActive && r.accountActive,
    defaultTds: r.defaultTds }]));
}

/** GET /expense-categories: every category by name, with its accounts by code, then name. */
export async function expenseCategoriesList(ctx: Ctx): Promise<Out<typeof listExpenseCategories>> {
  const tx = accountsTx(ctx);
  const rows = await tx.select().from(expenseCategories).orderBy(asc(expenseCategories.nameKey));
  const links = await tx.select({ categoryId: expenseCategoryAccounts.categoryId, id: accounts.id, code: accounts.code, name: accounts.name })
    .from(expenseCategoryAccounts).innerJoin(accounts, eq(accounts.id, expenseCategoryAccounts.accountId))
    .orderBy(asc(accounts.code), asc(accounts.nameKey));
  return { items: rows.map((c) => ({ id: c.id, name: c.name, credit: c.credit === 'allowed' ? 'allowed' : 'blocked', blockedClause: c.blockedClause,
    active: c.active, defaultTdsSectionId: c.defaultTdsSectionId, accounts: links.filter((l) => l.categoryId === c.id).map(({ id, code, name }) => ({ id, code, name })) })) };
}

/** POST /expense-categories. */
export async function addExpenseCategory(ctx: Ctx, c: In<typeof createExpenseCategory>): Promise<Out<typeof createExpenseCategory>> {
  await checkAccounts(ctx, c.accountIds);
  const tx = accountsTx(ctx);
  const [row] = await tx.insert(expenseCategories).values({ name: c.name, credit: c.credit, blockedClause: c.blockedClause,
    defaultTdsSectionId: c.defaultTdsSectionId ?? null })
    .returning({ id: expenseCategories.id }).catch((e: unknown) => {
      throw constraintOf(e) === 'ux_expense_categories_name_key' ? nameTaken() : e;
    });
  const id = row?.id ?? '';
  await tx.insert(expenseCategoryAccounts).values(c.accountIds.map((accountId) => ({ categoryId: id, accountId })));
  return { id };
}

/** PATCH /expense-categories/:id: a new account list replaces the old, keeping the links that stay. */
export async function changeExpenseCategory(ctx: Ctx, c: In<typeof setExpenseCategory>): Promise<Out<typeof setExpenseCategory>> {
  const tx = accountsTx(ctx);
  const [found] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, c.id)).for('update');
  if (found === undefined) throw new AppError('not_found', 'There’s no such expense category');
  const set = { ...(c.name === undefined ? {} : { name: c.name }), ...(c.active === undefined ? {} : { active: c.active }),
    ...(c.defaultTdsSectionId === undefined ? {} : { defaultTdsSectionId: c.defaultTdsSectionId }),
    ...(c.credit === undefined ? {} : { credit: c.credit, blockedClause: c.credit === 'allowed' ? null : c.blockedClause ?? null }) };
  if (Object.keys(set).length > 0) {
    await tx.update(expenseCategories).set(set).where(eq(expenseCategories.id, c.id)).catch((e: unknown) => {
      throw constraintOf(e) === 'ux_expense_categories_name_key' ? nameTaken() : e;
    });
  }
  if (c.accountIds !== undefined) {
    await checkAccounts(ctx, c.accountIds);
    await tx.delete(expenseCategoryAccounts).where(and(eq(expenseCategoryAccounts.categoryId, c.id),
      notInNonEmpty(expenseCategoryAccounts.accountId, c.accountIds)));
    await tx.insert(expenseCategoryAccounts).values(c.accountIds.map((accountId) => ({ categoryId: c.id, accountId }))).onConflictDoNothing();
  }
  return {};
}
