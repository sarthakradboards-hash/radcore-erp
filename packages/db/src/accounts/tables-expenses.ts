// lib-accounts' expenses (M5-02, RAD-152; ADR-009 §3): the categories and the accounts each may post to. Beside
// ./tables.ts, one file per document family (ADR-009 §10). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a
// generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, createdMoment, id, money, percent, radcoreTable } from '../columns.ts';
import { files } from '../platform/tables.ts';
import { accounts, journalEntries, parties } from './tables.ts';

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

/**
 * An expense (M5-02, ADR-009 §3): a supplier's bill for a cost, paid at once from Cash or a bank account
 * (`pay_from_account_id`), or on credit to the supplier (none). `stated_total` is the bill's total as printed; `total` is
 * what the supplier is owed, the whole of it on credit and nothing when paid at once, since payments apply to it
 * (allocatable_documents reads `party_id`, `status`, `total` and `business_date`). Its owner is its maker (`created_by`).
 */
export const expenses = radcoreTable('expenses', {
  id: id(), createdAt: createdMoment(),
  number: text().unique(),
  businessDate: date({ mode: 'string' }).notNull(),
  partyId: uuid().references(() => parties.id, { onDelete: 'restrict' }),
  supplierInvoiceNumber: boundedText({ max: 40 }).notNull(),
  supplierInvoiceDate: date({ mode: 'string' }).notNull(),
  supplierGstin: text(),
  payFromAccountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
  status: text().notNull().default('draft'),
  statedTotal: money().notNull(),
  total: money().notNull(),
  fileId: uuid().references(() => files.id, { onDelete: 'restrict' }),
  notes: boundedText({ max: 500 }),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_expenses_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  check('ck_expenses_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.postedEntryId} is null)`),
  check('ck_expenses_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  // On credit it's the supplier's, whole; paid at once, nothing is owed (ADR-009 §3).
  check('ck_expenses_owed', sql`(${t.payFromAccountId} is null and ${t.partyId} is not null and ${t.total} = ${t.statedTotal})
    or (${t.payFromAccountId} is not null and ${t.total} = 0)`),
  check('ck_expenses_supplier_date', sql`${t.supplierInvoiceDate} <= ${t.businessDate}`),
  check('ck_expenses_supplier_gstin', sql`${t.supplierGstin} is null or ${t.supplierGstin} ~ '^[0-9]{2}[A-Z0-9]{13}$'`),
  check('ck_expenses_supplier_number', sql`btrim(${t.supplierInvoiceNumber}) <> ''`),
  index('ix_expenses_party').on(t.partyId),
  index('ix_expenses_pay_from').on(t.payFromAccountId),
  index('ix_expenses_file').on(t.fileId),
  index('ix_expenses_posted_entry').on(t.postedEntryId),
  index('ix_expenses_cancel_entry').on(t.cancelEntryId),
  index('ix_expenses_page').on(t.businessDate, t.createdAt, t.id),
]);

/** An expense's line (ADR-009 §2, §3): its category and one of that category's accounts (a composite key, so no other
 * account is reachable), the taxable value, the rate and the tax by head as printed, and, set at posting, the input
 * credit claimed by head and why none (as purchase bill lines, for ADR-010's 3B). */
export const expenseLines = radcoreTable('expense_lines', {
  id: id(),
  expenseId: uuid().notNull().references(() => expenses.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  categoryId: uuid().notNull(),
  accountId: uuid().notNull(),
  description: boundedText({ max: 100 }),
  taxable: money().notNull(),
  gstRate: percent().notNull(),
  cgst: money().notNull(), sgst: money().notNull(), igst: money().notNull(),
  creditCgst: money(), creditSgst: money(), creditIgst: money(), creditReason: text(),
}, (t) => [
  check('ck_expense_lines_heads', sql`${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  check('ck_expense_lines_credit', sql`num_nulls(${t.creditCgst}, ${t.creditSgst}, ${t.creditIgst}) in (0, 3)
    and (${t.creditReason} is null or ${t.creditCgst} is not null)`),
  // All the line's tax, or none and why.
  check('ck_expense_lines_credit_whole', sql`${t.creditCgst} is null
    or (${t.creditReason} is null and ${t.creditCgst} = ${t.cgst} and ${t.creditSgst} = ${t.sgst} and ${t.creditIgst} = ${t.igst})
    or (${t.creditReason} in ('supplier_kind', 'blocked', 'state') and ${t.creditCgst} = 0 and ${t.creditSgst} = 0 and ${t.creditIgst} = 0)`),
  uniqueIndex('ux_expense_lines_line').on(t.expenseId, t.lineNo),
  index('ix_expense_lines_category_account').on(t.categoryId, t.accountId),
  foreignKey({ name: 'fk_expense_lines_category_account', columns: [t.categoryId, t.accountId],
    foreignColumns: [expenseCategoryAccounts.categoryId, expenseCategoryAccounts.accountId] }).onDelete('restrict'),
]);
