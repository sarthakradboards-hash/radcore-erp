// lib-accounts' expenses (M5-02, RAD-152; ADR-009 §3): the categories and the accounts each may post to. Beside
// ./tables.ts, one file per document family (ADR-009 §10). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a
// generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';
import { accounts } from './tables.ts';

/** An expense category (ADR-009 §2, §3): whether its input GST may be claimed, and where blocked, the clause of section
 * 17(5) that blocks it (CA-05). A new one starts blocked. Switched off, never deleted. */
export const expenseCategories = radcoreTable('expense_categories', {
  id: id(),
  name: boundedText({ max: 80 }).notNull(),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
  credit: text().notNull().default('blocked'),
  blockedClause: text(),
  active: boolean().notNull().default(true),
}, (t) => [
  check('ck_expense_categories_credit', sql`${t.credit} in ('allowed', 'blocked')`),
  // 17(5)'s clauses, (a) to (i), and only (b)'s sub-clauses, as "(b)(i)".
  check('ck_expense_categories_clause', sql`(${t.credit} = 'blocked') = (${t.blockedClause} is not null)
    and (${t.blockedClause} is null or ${t.blockedClause} ~ '^\\((a|aa|ab|c|d|e|f|fa|g|h|i)\\)$|^\\(b\\)(\\((i|ii|iii)\\))?$')`),
  uniqueIndex('ux_expense_categories_name_key').on(t.nameKey),
]);

/** The accounts a category may post to (ADR-009 §3): ordinary expense accounts only, held by the composite key to
 * `accounts (id, type, control_kind)` with the row's copies fixed by CHECK, so no category points at Bank, a control
 * account or an income account. An expense line names one of these rows, so no other account is reachable. */
export const expenseCategoryAccounts = radcoreTable('expense_category_accounts', {
  categoryId: uuid().notNull().references(() => expenseCategories.id, { onDelete: 'restrict' }),
  accountId: uuid().notNull(),
  accountType: text().notNull().default('expense'),
  accountControlKind: text().notNull().default('none'),
}, (t) => [
  primaryKey({ name: 'pk_expense_category_accounts', columns: [t.categoryId, t.accountId] }),
  check('ck_expense_category_accounts_ordinary', sql`${t.accountType} = 'expense' and ${t.accountControlKind} = 'none'`),
  foreignKey({ name: 'fk_expense_category_accounts_account', columns: [t.accountId, t.accountType, t.accountControlKind],
    foreignColumns: [accounts.id, accounts.type, accounts.controlKind] }).onDelete('restrict'),
  index('ix_expense_category_accounts_account').on(t.accountId, t.accountType, t.accountControlKind),
]);
