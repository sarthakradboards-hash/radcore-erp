// What an expense's draft form holds and how it goes to createExpense / replaceExpense (RAD-168 on RAD-152's routes,
// ADR-009 §3): the supplier's bill as printed, how it's paid, its file and lines. Empty boxes are none. A line's TDS
// section and SAC are left out to take the supplier's or category's default; "none" says no TDS. A saved draft keeps what
// the server stored. Every figure is the person's own as the bill prints it: nothing is worked out here.
import { indiaDate } from '@radcore/lib-common';
import { createExpense, type getExpense } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../admin/decimal.ts';

/** The TDS box's "no TDS", which is sent as null; empty is left out, so the default applies. */
export const NO_TDS = 'none';

const required = (message: string) => z.string().trim().min(1, message);
const orNull = (v: string) => (v === '' ? null : v);

const formLine = z.object({
  categoryId: required(t('books.expense.form.err.category')), accountId: required(t('books.expense.form.err.account')),
  description: z.string().trim(), taxable: required(t('books.expense.form.err.taxable')), gstRate: required(t('books.expense.form.err.rate')),
  cgst: z.string().trim(), sgst: z.string().trim(), igst: z.string().trim(), tds: z.string(), sac: z.string().trim(),
});

export const expenseSchema = z.object({
  businessDate: required(t('books.expense.form.err.date')), supplierId: z.string(),
  supplierInvoiceNumber: required(t('books.expense.form.err.invoiceNumber')),
  supplierInvoiceDate: required(t('books.expense.form.err.invoiceDate')), supplierGstin: z.string().trim().toUpperCase(),
  payFromAccountId: z.string(), statedTotal: required(t('books.expense.form.err.total')), fileId: z.string(), notes: z.string().trim(),
  lines: z.array(formLine).min(1, t('books.expense.form.err.lines')),
}).transform((v): z.input<typeof createExpense.input> => ({
  businessDate: v.businessDate, supplierId: orNull(v.supplierId), supplierInvoiceNumber: v.supplierInvoiceNumber,
  supplierInvoiceDate: v.supplierInvoiceDate, supplierGstin: orNull(v.supplierGstin), payFromAccountId: orNull(v.payFromAccountId),
  statedTotal: v.statedTotal, fileId: orNull(v.fileId), notes: orNull(v.notes),
  lines: v.lines.map((l) => ({
    categoryId: l.categoryId, accountId: l.accountId, description: orNull(l.description), taxable: l.taxable, gstRate: l.gstRate,
    cgst: l.cgst === '' ? '0' : l.cgst, sgst: l.sgst === '' ? '0' : l.sgst, igst: l.igst === '' ? '0' : l.igst,
    ...(l.tds === '' ? {} : { tdsSectionId: l.tds === NO_TDS ? null : l.tds }),
    ...(l.sac === '' ? {} : { sac: l.sac }),
  })),
})).pipe(createExpense.input);

export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseValues = z.output<typeof expenseSchema>;
export type LineInput = ExpenseInput['lines'][number];

export const blankLine = (): LineInput => ({
  categoryId: '', accountId: '', description: '', taxable: '', gstRate: '', cgst: '', sgst: '', igst: '', tds: '', sac: '',
});
export const blankExpense = (): ExpenseInput => ({
  businessDate: indiaDate(new Date()), supplierId: '', supplierInvoiceNumber: '', supplierInvoiceDate: '', supplierGstin: '',
  payFromAccountId: '', statedTotal: '', fileId: '', notes: '', lines: [blankLine()],
});

/** A saved draft, back into the form. A line saved with no TDS section stays so: left to the default again, saving could
 * add a deduction nobody chose. */
export function expenseToForm(e: z.output<typeof getExpense.output>): ExpenseInput {
  return {
    businessDate: e.businessDate, supplierId: e.supplierId ?? '', supplierInvoiceNumber: e.supplierInvoiceNumber,
    supplierInvoiceDate: e.supplierInvoiceDate, supplierGstin: e.supplierGstin ?? '', payFromAccountId: e.payFromAccountId ?? '',
    statedTotal: e.statedTotal, fileId: e.fileId ?? '', notes: e.notes ?? '',
    lines: e.lines.map((l) => ({
      categoryId: l.categoryId, accountId: l.accountId, description: l.description ?? '', taxable: asPrice(l.taxable),
      gstRate: asWritten(l.gstRate), cgst: asPrice(l.cgst), sgst: asPrice(l.sgst), igst: asPrice(l.igst),
      tds: l.tdsSectionId ?? NO_TDS, sac: l.sac ?? '',
    })),
  };
}

type Option = { value: string; label: string };
/** A saved value the choices don't hold (switched off since, or the list isn't readable) stays a choice, so saving never
 * changes it unseen. */
export const keeping = (options: readonly Option[], current: string, label: string): readonly Option[] =>
  (current === '' || options.some((o) => o.value === current) ? options : [...options, { value: current, label }]);
