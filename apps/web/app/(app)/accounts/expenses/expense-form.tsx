'use client';
// The expense draft form (RAD-168 on RAD-152's createExpense / replaceExpense, ADR-009 §3): the supplier's bill as printed
// (no supplier for a one-off paid at once), how it's paid, its file, and its lines, each posting to one of its category's
// accounts with its tax as the bill shows it. The server checks all of it; posting is on the expense's page.
import { listExpenseCategories, listParties, listTdsSections } from '@radcore/lib-accounts/contract';
import { expenseBillFiles } from '@radcore/lib-platform/contract';
import { useEffect, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { categoryChoices } from '../../purchases/bills/bill-values.ts';
import { BillFile } from '../../purchases/bills/bill-form.tsx';
import { PickedField } from '../../sales/picked-field.tsx';
import { useMoneyAccounts } from '../../sales/money-accounts.ts';
import { importWhenChecked } from '../bank/statement-values.ts';
import { sectionLabel } from '../payments/payment-values.ts';
import { EXPENSE_MESSAGES, namingLine } from './expense-values.ts';
import { blankLine, expenseSchema, keeping, NO_TDS, type ExpenseInput, type ExpenseValues } from './form-values.ts';

const useSuppliers = (query: string) => useApiSearch(listParties, query, { params: { filter: { buysFrom: true, active: true } } });

/** The supplier, or none: a one-off expense paid at once may name none, and then claims no credit. */
function Supplier({ saved }: { saved: { id: string; name: string } | null }) {
  const { control, setValue } = useFormContext<ExpenseInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  return (
    <>
      {/* Keyed so that clearing it empties the box too, not just the value. */}
      <PickedField key={supplierId === '' ? 'none' : 'picked'} name="supplierId" label={t('books.expense.form.supplier')}
        hint={t('books.expense.form.supplier.hint')} initial={saved !== null && saved.id === supplierId ? saved : null} useSearch={useSuppliers}
        optionLabel={(p) => p.name} />
      {supplierId === '' ? null : (
        <button type="button" className="kit-button" onClick={() => { setValue('supplierId', '', { shouldDirty: true }); setValue('supplierGstin', ''); }}>
          {t('books.expense.form.supplier.clear')}
        </button>
      )}
    </>
  );
}

/** On credit, or paid at once from Cash or a bank account. Drawn once the accounts are in, so a saved one shows. */
function PaidFrom() {
  const { control } = useFormContext<ExpenseInput>();
  const current = useWatch({ control, name: 'payFromAccountId' });
  const accounts = useMoneyAccounts();
  if (accounts === null) return <p>{t('loading')}</p>;
  const options = keeping([{ value: '', label: t('books.expense.onCredit') }, ...(accounts === 'hidden' ? [] : accounts)], current,
    t('books.expense.form.savedAccount'));
  return <SelectField name="payFromAccountId" label={t('books.expense.col.paid')} options={options}
    {...(accounts === 'hidden' ? { hint: t('books.expense.form.accountsHidden') } : {})} />;
}

/** One line: its category and one of the category's accounts, what it's for, its value and tax as printed, and its TDS and
 * SAC where they differ from the defaults. */
function ExpenseLine({ index, onRemove }: { index: number; onRemove: (() => void) | null }) {
  const { control, setValue } = useFormContext<ExpenseInput>();
  const categoryId = useWatch({ control, name: `lines.${index}.categoryId` });
  const accountId = useWatch({ control, name: `lines.${index}.accountId` });
  const tds = useWatch({ control, name: `lines.${index}.tds` });
  // A new category empties the account, which may not be one of its own.
  const seen = useRef(categoryId);
  useEffect(() => {
    if (seen.current === categoryId) return;
    seen.current = categoryId;
    setValue(`lines.${index}.accountId`, '');
  }, [categoryId, index, setValue]);
  const categories = useApiQuery(listExpenseCategories, {});
  const mayTds = useMe().permissions.includes('tds:read');
  const sections = useApiQuery(listTdsSections, {}, { enabled: mayTds });
  // Drawn only once the categories are in: a select drawn without them can't show a saved choice (e2e-playwright on #450).
  const choices = categoryChoices(categories.data?.items, categoryId);
  const chosen = categories.data?.items.find((c) => c.id === categoryId);
  const money = { inputMode: 'decimal', autoComplete: 'off' } as const;
  return (
    <fieldset>
      <legend>{t('books.expense.form.line', { n: String(index + 1) })}</legend>
      {categories.error !== null ? (
        <div role="alert" className="kit-form-alert">
          {t('books.expense.form.categoriesFailed')} <button type="button" className="kit-button" onClick={() => void categories.refetch()}>{t('error.retry')}</button>
        </div>
      ) : choices === null ? <p>{t('loading')}</p> : (
        <>
          <SelectField name={`lines.${index}.categoryId`} label={t('books.expense.form.category')} placeholder={t('books.expense.form.category.pick')}
            options={choices} />
          {chosen === undefined ? null : (
            <SelectField name={`lines.${index}.accountId`} label={t('books.expense.form.account')} placeholder={t('books.expense.form.account.pick')}
              options={keeping(chosen.accounts.map((a) => ({ value: a.id, label: a.name })), accountId, t('books.expense.form.savedAccount'))} />
          )}
        </>
      )}
      <TextField name={`lines.${index}.description`} label={t('books.expense.form.description')} autoComplete="off" />
      <TextField name={`lines.${index}.taxable`} label={t('books.expense.line.taxable')} {...money} />
      <TextField name={`lines.${index}.gstRate`} label={t('books.expense.form.rate')} {...money} />
      <TextField name={`lines.${index}.cgst`} label={t('books.expense.line.cgst')} hint={t('books.expense.form.tax.hint')} {...money} />
      <TextField name={`lines.${index}.sgst`} label={t('books.expense.line.sgst')} {...money} />
      <TextField name={`lines.${index}.igst`} label={t('books.expense.line.igst')} {...money} />
      {/* Without tds:read the line keeps what it holds: a new one takes the default, a saved one what was saved. */}
      {!mayTds ? null : sections.error !== null ? (
        <div role="alert" className="kit-form-alert">
          {t('books.pay.tdsSection.failed')} <button type="button" className="kit-button" onClick={() => void sections.refetch()}>{t('error.retry')}</button>
        </div>
      ) : sections.data === undefined ? <p>{t('loading')}</p> : (
        <SelectField name={`lines.${index}.tds`} label={t('books.expense.form.tds')}
          options={keeping([{ value: '', label: t('books.expense.form.tds.default') }, { value: NO_TDS, label: t('books.pay.tdsSection.none') },
            ...sections.data.items.map((s) => ({ value: s.id, label: sectionLabel(s) }))], tds, t('books.expense.form.savedSection'))} />
      )}
      <TextField name={`lines.${index}.sac`} label={t('books.expense.form.sac')} hint={t('books.expense.form.sac.hint')} inputMode="numeric" autoComplete="off" />
      {onRemove === null ? null
        : <button type="button" className="kit-button" onClick={onRemove}>{t('books.expense.form.removeLine', { n: String(index + 1) })}</button>}
    </fieldset>
  );
}

function Lines() {
  const { control } = useFormContext<ExpenseInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => <ExpenseLine key={f.id} index={i} onRemove={fields.length > 1 ? () => remove(i) : null} />)}
      {fields.length < 100
        ? <button type="button" className="kit-button" onClick={() => append(blankLine())}>{t('books.expense.form.addLine')}</button> : null}
    </>
  );
}

export function ExpenseForm({ labelledBy, initial, supplier = null, submit, onSubmit }: {
  labelledBy: string; initial: ExpenseInput; supplier?: { id: string; name: string } | null; submit: string;
  onSubmit: (values: ExpenseValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={expenseSchema} saved={false} messages={EXPENSE_MESSAGES} defaultValues={initial}
      // The bill's file may still be being checked, so a not_ready is asked again for a while.
      onSubmit={async (v) => { await importWhenChecked(() => onSubmit(v)).catch((e: unknown) => { throw namingLine(e); }); }}>
      <Supplier saved={supplier} />
      <TextField name="supplierGstin" label={t('books.expense.gstin')} hint={t('books.expense.form.gstin.hint')} autoComplete="off" />
      <TextField name="supplierInvoiceNumber" label={t('books.expense.form.invoiceNumber')} autoComplete="off" />
      <TextField name="supplierInvoiceDate" label={t('books.expense.form.invoiceDate')} type="date" />
      <TextField name="businessDate" label={t('books.expense.form.date')} hint={t('books.expense.form.date.hint')} type="date" />
      <PaidFrom />
      <TextField name="statedTotal" label={t('books.expense.col.total')} hint={t('books.expense.form.total.hint')} inputMode="decimal" autoComplete="off" />
      <BillFile files={expenseBillFiles} messages={EXPENSE_MESSAGES} />
      <TextAreaField name="notes" label={t('books.expense.notes')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
