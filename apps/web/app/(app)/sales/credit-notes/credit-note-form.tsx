'use client';
// The form a credit note is written in (RAD-125 on RAD-114's contract): a posted invoice, a date, why, and either the taxable value
// to credit on each of its lines (value only) or the goods that come back (a quantity, the batches and, for a serialised item, the
// serials, to a place), and optionally a counter refund paid from a cash or bank account as the note posts. The batches and units
// on offer are the invoice line's own: the batches its goods left in and its units still out, each with the batch it left in, so
// ticking a serial fills its batch. The GST, the round-off and whether the credit is late are worked out by the server when it is
// posted. Never past what is left of the invoice: the server refuses (`exceeds_invoice`, `exceeds_credit`), and the form is
// checked with the contract's own schema.
import { formatMoney } from '@radcore/lib-common';
import { listAccounts } from '@radcore/lib-accounts/contract';
import { getInvoice, listInvoices } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { useController, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { RadioField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CREDIT_MESSAGES } from './shared.tsx';
import { listLocationKinds, listLocations } from '@radcore/lib-stock/contract';
import { asWritten } from '../../admin/decimal.ts';
import { batchKey, creditSchema, type CreditInput, type CreditLineInput, type CreditValues } from './credit-values.ts';

/** The places goods can come back into: active places of a kind that sells. The form waits for them, so a select never loses its
 * value to options that arrive late. */
function usePlaces() {
  const kinds = useApiQuery(listLocationKinds, {});
  const places = useApiList(listLocations, { filter: { status: 'active' } }, { limit: 200 });
  const sells = new Set(kinds.data?.kinds.filter((k) => k.sellable).map((k) => k.kind));
  const options = places.items.filter((l) => kinds.data === undefined || sells.has(l.kind)).map((l) => ({ value: l.id, label: l.name }));
  return { options, ready: !places.isPending && !kinds.isPending };
}

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
            qty: '', pick: {}, serials: [],
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

/** One line's goods back: a quantity box, how many go back into each batch it left in, and for a serialised item its units still out,
 * ticked: the quantity and the batches follow what is ticked, since each unit says which batch it left in. */
function GoodsBack({ index, invoiceId, invoiceLineId }: { index: number; invoiceId: string; invoiceLineId: string }) {
  const { setValue } = useFormContext<CreditInput>();
  const { field } = useController<CreditInput, `lines.${number}.serials`>({ name: `lines.${index}.serials` });
  const invoice = useApiQuery(getInvoice, { id: invoiceId }, { enabled: invoiceId !== '' }).data;
  const goods = invoice?.lines.find((l) => l.id === invoiceLineId)?.goods;
  if (goods === undefined) return <p>{t('loading')}</p>;
  const picked: readonly string[] = field.value;
  const batchNo = (id: string | null) => goods.batches.find((b) => b.batchId === id)?.batchNo ?? null;
  const labelOf = (id: string | null) => {
    const no = batchNo(id);
    return id === null || no === null ? t('sales.credit.form.batch.unknown') : t('sales.credit.form.batch.no', { no });
  };
  const toggle = (serialNo: string) => {
    const next = picked.includes(serialNo) ? picked.filter((s) => s !== serialNo) : [...picked, serialNo];
    field.onChange(next);
    // Each picked unit goes back into the batch it left in: the batches are the count of units in each.
    const counts = new Map<string, number>();
    for (const u of goods.units.filter((x) => next.includes(x.serialNo))) counts.set(batchKey(u.batchId), (counts.get(batchKey(u.batchId)) ?? 0) + 1);
    for (const b of goods.batches) setValue(`lines.${index}.pick.${batchKey(b.batchId)}`, String(counts.get(batchKey(b.batchId)) ?? ''));
    setValue(`lines.${index}.qty`, next.length === 0 ? '' : String(next.length));
  };
  return (
    <>
      <TextField name={`lines.${index}.qty`} label={t('sales.credit.form.line.qty')} inputMode="decimal" autoComplete="off" />
      {goods.units.length === 0 ? null : (
        <fieldset>
          <legend>{t('sales.credit.form.serials')}</legend>
          <p className="kit-field-hint">{t('sales.credit.form.serials.hint')}</p>
          <ul className="admin-checklist">
            {goods.units.map((u) => (
              <li key={u.serialNo}>
                <label className="admin-grant">
                  <input type="checkbox" checked={picked.includes(u.serialNo)} onChange={() => toggle(u.serialNo)} />
                  <span>{u.serialNo}, {labelOf(u.batchId)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset>
        <legend>{t('sales.credit.form.batches')}</legend>
        <p className="kit-field-hint">{t('sales.credit.form.batches.hint')}</p>
        {goods.batches.map((b) => (
          <TextField key={batchKey(b.batchId)} name={`lines.${index}.pick.${batchKey(b.batchId)}`} inputMode="decimal" autoComplete="off"
            label={t('sales.credit.form.batch', { batch: labelOf(b.batchId), left: asWritten(b.qty) })} />
        ))}
      </fieldset>
    </>
  );
}

// One useFieldArray for the lines, shared with the invoice chooser: a second one on the same name wouldn't see the first's.
function Lines() {
  const { control } = useFormContext<CreditInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const invoiceId = useWatch({ control, name: 'invoiceId' });
  const kind = useWatch({ control, name: 'kind' });
  return (
    <>
      <AddInvoice append={append} hasLines={fields.length > 0} />
      {invoiceId !== '' && fields.length > 0 ? <AgainstInvoice id={invoiceId} /> : null}
      {fields.length > 0
        ? <p>{t(kind === 'goods' ? 'sales.credit.form.lines.hint.goods' : 'sales.credit.form.lines.hint')}</p>
        : <p>{t('sales.credit.form.lines.none')}</p>}
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: {f.label}</legend>
          {kind === 'goods' ? <GoodsBack index={i} invoiceId={invoiceId} invoiceLineId={f.invoiceLineId} /> : (
            <TextField name={`lines.${i}.taxable`} label={t('sales.credit.form.line.taxable')} inputMode="decimal" autoComplete="off"
              hint={f.invoiced === '' ? undefined : t('sales.credit.form.line.invoiced', { amount: formatMoney(f.invoiced) })} />
          )}
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.credit.form.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
    </>
  );
}

/** The accounts a counter refund can be paid from: Cash, Bank, and the bank accounts under Bank (what the server takes as a money
 * account; it checks again when the note is approved). A person who can't read the chart (journal:read) is told the refund
 * can't be offered, and the note is written without one. */
function useRefundAccounts() {
  const q = useApiQuery(listAccounts, {});
  if (q.error !== null) return 'hidden';
  if (q.data === undefined) return null;
  const bank = q.data.items.find((a) => a.systemKey === 'bank')?.id;
  const money = (a: (typeof q.data.items)[number]) => a.systemKey === 'cash' || a.systemKey === 'bank' || (bank !== undefined && a.parentId === bank);
  return q.data.items.filter((a) => a.active && money(a)).map((a) => ({ value: a.id, label: a.name }));
}

/** Where goods come back to: shown for goods back only. */
function PlaceField({ options }: { options: readonly { value: string; label: string }[] }) {
  const { control } = useFormContext<CreditInput>();
  const kind = useWatch({ control, name: 'kind' });
  return kind === 'goods'
    ? <SelectField name="locationId" label={t('sales.credit.form.place')} placeholder={t('sales.credit.form.place.none')} options={options} />
    : null;
}

/** The form. */
export function CreditNoteForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: CreditInput; submit: string; onSubmit: (values: CreditValues) => Promise<unknown>;
}) {
  const accounts = useRefundAccounts();
  const places = usePlaces();
  if (!places.ready) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={creditSchema} saved={false} messages={CREDIT_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <RadioField name="kind" label={t('sales.credit.form.kind')} options={[
        { value: 'value', label: t('sales.credit.kind.value') }, { value: 'goods', label: t('sales.credit.kind.goods') },
      ]} />
      <PlaceField options={places.options} />
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      <TextAreaField name="reason" label={t('sales.credit.form.reason')} />
      <Lines />
      {accounts === 'hidden' ? <p>{t('sales.credit.form.refund.hidden')}</p> : null}
      {accounts === null || accounts === 'hidden' || accounts.length === 0 ? null : (
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
