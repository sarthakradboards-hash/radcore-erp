'use client';
// The form a credit note is written in (RAD-125 on RAD-114's contract): a posted invoice, a date, why, and the taxable value to
// credit on each of its lines, and optionally a counter refund paid from a cash or bank account as the note posts. The GST,
// the round-off and whether the credit is late are worked out by the server when it is posted. Never past what is left of
// the invoice: the server refuses (`exceeds_invoice`, `exceeds_credit`), and the form is checked with the contract's own schema.
import { formatMoney } from '@radcore/lib-common';
import { listAccounts } from '@radcore/lib-accounts/contract';
import { getInvoice, listInvoices } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CREDIT_MESSAGES } from './shared.tsx';
import { creditSchema, type CreditInput, type CreditLineInput, type CreditValues } from './credit-values.ts';

/** Brings an invoice's lines in: a choice among the posted invoices, and the button that adds its lines. */
function AddInvoice({ append, hasLines }: { append: (lines: CreditLineInput[]) => void; hasLines: boolean }) {
  const { control, setValue } = useFormContext<CreditInput>();
  const chosen = useWatch({ control, name: 'invoiceId' });
  const [invoiceId, setInvoiceId] = useState('');
  const invoices = useApiList(listInvoices, { filter: { status: 'posted' } });
  const invoice = useApiQuery(getInvoice, { id: invoiceId }, { enabled: invoiceId !== '' }).data;
  // A credit note credits one invoice: once its lines are in, another's can't be added until they are removed.
  if (chosen !== '' && hasLines) return null;
  return (
    <div className="kit-field">
      <label htmlFor="credit-invoice">{t('sales.credit.form.invoice')}</label>
      <p className="kit-field-hint">{t('sales.credit.form.invoice.hint')}</p>
      <select id="credit-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
        <option value="">{t('sales.credit.form.invoice.none')}</option>
        {invoices.items.map((i) => (
          <option key={i.id} value={i.id}>
            {t('sales.credit.form.invoice.option', { number: i.number ?? '', party: i.partyName, total: formatMoney(i.total) })}
          </option>
        ))}
      </select>
      {invoices.hasNextPage ? <button type="button" className="kit-button" onClick={invoices.fetchNextPage}>{t('kit.table.more')}</button> : null}
      <button type="button" className="kit-button" disabled={invoice === undefined}
        onClick={() => {
          if (invoice === undefined) return;
          setValue('invoiceId', invoice.id);
          append(invoice.lines.map((l) => ({
            invoiceLineId: l.id, itemId: l.itemId, label: `${l.name} (${l.sku})`, invoiced: l.taxable === null ? '' : l.taxable, taxable: '',
          })));
          setInvoiceId('');
        }}>{t('sales.credit.form.invoice.add')}</button>
    </div>
  );
}

/** Names the invoice the credit note is against once its lines are in. */
function AgainstInvoice({ id }: { id: string }) {
  const invoice = useApiQuery(getInvoice, { id }).data;
  return invoice === undefined ? null : <p>{t('sales.credit.form.against', { number: invoice.number ?? '', party: invoice.partyName })}</p>;
}

// One useFieldArray for the lines, shared with the invoice chooser: a second one on the same name wouldn't see the first's.
function Lines() {
  const { control } = useFormContext<CreditInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const invoiceId = useWatch({ control, name: 'invoiceId' });
  return (
    <>
      <AddInvoice append={append} hasLines={fields.length > 0} />
      {invoiceId !== '' && fields.length > 0 ? <AgainstInvoice id={invoiceId} /> : null}
      {fields.length > 0 ? <p>{t('sales.credit.form.lines.hint')}</p> : <p>{t('sales.credit.form.lines.none')}</p>}
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: {f.label}</legend>
          <TextField name={`lines.${i}.taxable`} label={t('sales.credit.form.line.taxable')} inputMode="decimal" autoComplete="off"
            hint={f.invoiced === '' ? undefined : t('sales.credit.form.line.invoiced', { amount: formatMoney(f.invoiced) })} />
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.credit.form.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
    </>
  );
}

/** The accounts a counter refund can be paid from: active, non-control assets (cash and bank among them); the server checks it
 * is a money account. A person who can't read the chart sees no refund section: the note is written without one. */
function useRefundAccounts() {
  const q = useApiQuery(listAccounts, {});
  if (q.data === undefined) return null;
  return q.data.items.filter((a) => a.active && !a.control && a.type === 'asset').map((a) => ({ value: a.id, label: a.name }));
}

/** The form. */
export function CreditNoteForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: CreditInput; submit: string; onSubmit: (values: CreditValues) => Promise<unknown>;
}) {
  const accounts = useRefundAccounts();
  return (
    <Form aria-labelledby={labelledBy} schema={creditSchema} saved={false} messages={CREDIT_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <p>{t('sales.credit.form.kind.goods.soon')}</p>
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      <TextAreaField name="reason" label={t('sales.credit.form.reason')} />
      <Lines />
      {accounts === null || accounts.length === 0 ? null : (
        <fieldset>
          <legend>{t('sales.credit.form.refund')}</legend>
          <p className="kit-field-hint">{t('sales.credit.form.refund.hint')}</p>
          <TextField name="refundAmount" label={t('sales.credit.form.refund.amount')} inputMode="decimal" autoComplete="off" />
          <SelectField name="refundAccountId" label={t('sales.credit.form.refund.account')} placeholder={t('sales.credit.form.refund.account.none')} options={accounts} />
        </fieldset>
      )}
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
