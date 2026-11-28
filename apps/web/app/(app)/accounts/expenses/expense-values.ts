// What the expense screens work out (RAD-168 on RAD-152's routes, ADR-009 §3): the names behind a line's ids, the version
// an owner approves (ADR-007 §8), the credit claimed on a posted line in words, and every refusal in the screen's words
// (auditor-3 on #473). Every figure is the server's.
import { dateString, formatMoney, moneyString, sum } from '@radcore/lib-common';
import type { getExpense, listExpenseCategories } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { ApiError } from '../../../../lib/api-client.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { JOURNAL_MESSAGES } from '../shared.tsx';

type Expense = z.output<typeof getExpense.output>;
export type Line = Expense['lines'][number];
type Category = z.output<typeof listExpenseCategories.output>['items'][number];

// Posting and approving re-check the draft, then cancelling and deciding have their own. The journal words the rest.
const CODES = ['date_in_future', 'supplier_date_after_bill', 'needs_supplier', 'not_a_supplier', 'gstin_mismatch', 'not_money_account',
  'account_inactive', 'unknown_account', 'category_inactive', 'not_in_category', 'wrong_file_kind', 'upload_refused', 'not_ready', 'unknown_section',
  'wrong_status', 'bill_file_required', 'tax_mismatch', 'total_mismatch', 'company_profile_incomplete', 'series_full', 'tds_needs_party',
  'tds_overseas', 'no_tds_rate', 'tds_payee_mismatch', 'rcm_bill_has_tax', 'no_gst_rate', 'sac_required', 'date_before_source', 'has_allocations',
  'tds_deposited', 'own_request', 'approver_too_new', 'version_changed', 'not_pending'] as const;
/** The expense contracts' refusals in the screen's words, for Form's `messages`. */
export const EXPENSE_MESSAGES: Partial<Record<string, string>> = {
  ...JOURNAL_MESSAGES, ...Object.fromEntries(CODES.map((c) => [c, t(`books.expense.err.${c}`)])),
};

/** The screen's words stand alone, so a refusal of one line would lose which: it's re-thrown naming the line's number.
 * Its code is changed so the form shows these words as they are. Anything else comes back as it was. */
export function namingLine(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  const [first] = e.envelope.issues;
  const words = EXPENSE_MESSAGES[e.code];
  if (words === undefined || first?.path[0] !== 'lines' || typeof first.path[1] !== 'number') return e;
  const message = t('books.expense.err.onLine', { n: String(first.path[1] + 1), what: words });
  return new ApiError(e.status, { ...e.envelope, code: `${e.code}_on_line`, message, issues: [] });
}

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
