// lib-accounts' bank statements (M5-11, RAD-159; ADR-009 §11; RC-135, RC-136). SQL zone (ADR-002 §3): `sql` only as a
// CHECK's argument. Statement lines aren't ledger rows: nothing posts at import.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, json, money, radcoreTable } from '../columns.ts';
import { files } from '../platform/tables.ts';
import { accounts } from './tables.ts';

/**
 * How one bank account's statements are laid out (GL-053): the header names of the columns holding each field, by
 * which the header row is found below any title lines, and whether the newest row comes first. Set at the first upload
 * and reused. Its row is also the account's import lock: an import takes it FOR UPDATE, so two files for one account
 * are checked one after the other.
 */
export const statementFormats = radcoreTable('statement_formats', {
  accountId: uuid().primaryKey().references(() => accounts.id, { onDelete: 'restrict' }),
  dateColumn: boundedText({ max: 100 }).notNull(),
  narrationColumn: boundedText({ max: 100 }).notNull(),
  referenceColumn: boundedText({ max: 100 }),
  withdrawalColumn: boundedText({ max: 100 }).notNull(),
  depositColumn: boundedText({ max: 100 }).notNull(),
  balanceColumn: boundedText({ max: 100 }).notNull(),
  newestFirst: boolean().notNull(),
});

/**
 * One uploaded statement's import (ADR-009 §11): queued at the upload, then checked and stored by the worker in one
 * transaction, all or nothing. `imported` with what was new and already present, or `refused` with every refused row;
 * `undone` once its lines are taken out again.
 */
export const statementImports = radcoreTable('statement_imports', {
  id: id(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  fileId: uuid().notNull().references(() => files.id, { onDelete: 'restrict' }),
  status: text().notNull().default('queued'),
  newLines: integer(),
  presentLines: integer(),
  // What refused the file: [{ row, column, message }], at most 200 of them, or one for the whole file on row 0.
  refusals: json(),
}, (t) => [
  check('ck_statement_imports_status', sql`${t.status} in ('queued', 'imported', 'refused', 'undone')`),
  check('ck_statement_imports_counts', sql`(${t.status} in ('imported', 'undone')) = (${t.newLines} is not null and ${t.presentLines} is not null)`),
  index('ix_statement_imports_account').on(t.accountId),
  index('ix_statement_imports_file').on(t.fileId),
]);

/**
 * A bank statement's line, as the bank gave it (ADR-009 §11). Already present when the account, value date, direction,
 * amount, running balance and reference all equal a stored line's (RC-136): two payments of one amount on one day, or
 * an in and an out, have different balances, so both are kept. `seq` is the order lines were stored in, which is the
 * statement's own within an import.
 */
export const bankStatementLines = radcoreTable('bank_statement_lines', {
  id: id(),
  seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  importId: uuid().notNull().references(() => statementImports.id, { onDelete: 'restrict' }),
  rowNo: integer().notNull(),
  valueDate: date({ mode: 'string' }).notNull(),
  narration: boundedText({ max: 500 }).notNull(),
  reference: boundedText({ max: 100 }).notNull(),
  direction: text().notNull(),
  amount: money().notNull(),
  balance: money({ signed: true }).notNull(),
}, (t) => [
  check('ck_bank_statement_lines_direction', sql`${t.direction} in ('in', 'out')`),
  check('ck_bank_statement_lines_above_zero', sql`${t.amount} > 0`),
  uniqueIndex('ux_bank_statement_lines_present').on(t.accountId, t.valueDate, t.direction, t.amount, t.balance, t.reference),
  index('ix_bank_statement_lines_account_date').on(t.accountId, t.valueDate, t.seq),
  index('ix_bank_statement_lines_import').on(t.importId),
]);
