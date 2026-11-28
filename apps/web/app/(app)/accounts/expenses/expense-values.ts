// What the expense screens work out (RAD-168 on RAD-152's routes, ADR-009 §3): the names behind a line's ids, the version
// an owner approves (ADR-007 §8), the credit claimed on a posted line in words, and the refusals the screen words itself.
// Every figure is the server's. A refusal not worded here shows the server's own words, which name the line and figures.
import { dateString, formatMoney, moneyString, sum } from '@radcore/lib-common';
import type { getExpense, listExpenseCategories } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { JOURNAL_MESSAGES } from '../shared.tsx';

type Expense = z.output<typeof getExpense.output>;
export type Line = Expense['lines'][number];
type Category = z.output<typeof listExpenseCategories.output>['items'][number];

export const EXPENSE_MESSAGES: Partial<Record<string, string>> = {
  ...JOURNAL_MESSAGES,
  tds_deposited: t('books.expense.err.tds_deposited'),
  has_allocations: t('books.expense.err.has_allocations'),
};

/** An expense's name: its number once posted; before that, the supplier's bill it records. */
export const expenseTitle = (e: Pick<Expense, 'number' | 'supplierInvoiceNumber'>) =>
  e.number ?? t('books.expense.draftTitle', { invoice: e.supplierInvoiceNumber });

/** "Travel: Fuel and conveyance". An id the list doesn't have (or no list yet) is said to be unnamed, never shown raw. */
export function lineName(categories: readonly Category[], line: { categoryId: string; accountId: string }): string {
  const category = categories.find((c) => c.id === line.categoryId);
  const account = category?.accounts.find((a) => a.id === line.accountId);
  return category === undefined || account === undefined ? t('books.expense.unnamed') : `${category.name}: ${account.name}`;
}

type Heads = { cgst: string; sgst: string; igst: string };
export const taxOf = (h: Heads) => sum([h.cgst, h.sgst, h.igst]).toFixed(2);

/** A posted line's input credit: how much was claimed, or why none was (it's then part of the line's cost). */
export function creditWords(credit: (Heads & { reason: NonNullable<Line['credit']>['reason'] }) | null): string {
  if (credit === null) return '';
  return credit.reason === null ? formatMoney(taxOf(credit)) : t(`books.expense.credit.${credit.reason}`);
}

const version = z.object({
  businessDate: dateString(), payFromAccountId: z.string().nullable(), statedTotal: moneyString(), supplierInvoiceNumber: z.string(),
  supplierInvoiceDate: dateString(),
  lines: z.array(z.object({ categoryId: z.string(), accountId: z.string(), taxable: moneyString(), cgst: moneyString(), sgst: moneyString(),
    igst: moneyString() })),
});
/** What approving posts, read from the approval's own version, so what's shown is what's approved; null if unreadable. */
export const readCashVersion = (v: unknown) => version.safeParse(v).data ?? null;
