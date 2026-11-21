'use client';
// The form an invoice is written in (RAD-125 on RAD-113's contract): a customer, a date, notes, and the lines it bills.
// A line bills some of a posted delivery's line, at its order's rate and discount unless one is typed here. Choosing a
// customer offers their deliveries still waiting for an invoice; adding one brings its lines in, each for the quantity
// delivered, to cut down. What may be billed (quantity left, the customer's deliveries only, the date) is the server's to
// say; the form is checked with the contract's own schema.
import { listParties } from '@radcore/lib-accounts/contract';
import { formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { createInvoice, getDelivery, listToInvoice } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { PickedField } from '../picked-field.tsx';
import { ItemName } from '../shared.tsx';
import { INVOICE_MESSAGES } from './shared.ts';

const shape = createInvoice.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, or leaves the field out, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);
const emptyIsMissing = <T extends z.ZodType<unknown, string | undefined>>(inner: T) =>
  z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(inner);

const line = z.object({
  deliveryLineId: lineShape.deliveryLineId, itemId: z.string(), qty: lineShape.qty,
  rate: emptyIsMissing(lineShape.rate), discountPercent: emptyIsMissing(lineShape.discountPercent),
});
const invoiceSchema = z.object({
  partyId: z.string().min(1, t('sales.party.pick')).pipe(shape.partyId),
  businessDate: shape.businessDate,
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('sales.invoice.lines.none')).max(200, t('sales.lines.max')),
});
type InvoiceInput = z.input<typeof invoiceSchema>;
type InvoiceValues = z.output<typeof invoiceSchema>;

export const NEW_INVOICE: InvoiceInput = { partyId: '', businessDate: indiaDate(new Date()), notes: '', lines: [] };

const useParties = (query: string) => useApiSearch(listParties, query, { params: { filter: { kind: 'customer', active: true } } });

/** Brings a delivery's lines in: a choice among the customer's deliveries still waiting, and the button that adds them. */
function AddDelivery({ append }: { append: (lines: InvoiceInput['lines']) => void }) {
  const { control } = useFormContext<InvoiceInput>();
  const partyId = useWatch({ control, name: 'partyId' });
  const [deliveryId, setDeliveryId] = useState('');
  const waiting = useApiList(listToInvoice, { filter: { partyId } }, { enabled: partyId !== '' });
  const delivery = useApiQuery(getDelivery, { id: deliveryId }, { enabled: deliveryId !== '' }).data;
  if (partyId === '') return null;
  if (waiting.items.length === 0) return <p>{waiting.isPending ? t('loading') : t('sales.invoice.delivery.none.left')}</p>;
  return (
    <div className="kit-field">
      <label htmlFor="invoice-delivery">{t('sales.invoice.delivery')}</label>
      <p className="kit-field-hint">{t('sales.invoice.delivery.hint')}</p>
      <select id="invoice-delivery" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}>
        <option value="">{t('sales.invoice.delivery.none')}</option>
        {waiting.items.map((d) => (
          <option key={d.id} value={d.id}>
            {t('sales.invoice.delivery.option', { number: d.number, date: formatDate(d.businessDate), amount: formatMoney(d.toInvoice) })}
          </option>
        ))}
      </select>
      <button type="button" className="kit-button" disabled={delivery === undefined}
        onClick={() => {
          if (delivery === undefined) return;
          append(delivery.lines.map((l) => ({ deliveryLineId: l.id, itemId: l.itemId, qty: asWritten(l.qty), rate: '', discountPercent: '' })));
          setDeliveryId('');
        }}>{t('sales.invoice.delivery.add')}</button>
    </div>
  );
}

// One useFieldArray for the lines, shared with the delivery chooser: a second one on the same name wouldn't see the first's.
function Lines() {
  const { control } = useFormContext<InvoiceInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      <AddDelivery append={append} />
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: <ItemName id={f.itemId} /></legend>
          <TextField name={`lines.${i}.qty`} label={t('sales.invoice.line.qty')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.rate`} label={t('sales.invoice.line.rate')} hint={t('sales.invoice.line.rate.hint')}
            inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.discountPercent`} label={t('sales.invoice.line.discount')}
            hint={t('sales.invoice.line.discount.hint')} inputMode="decimal" autoComplete="off" />
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.line.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
      {fields.length === 0 ? <p>{t('sales.invoice.lines.none')}</p> : <p>{t('sales.invoice.lines.rate.note')}</p>}
    </>
  );
}

/** The form. `initial` is what it starts from, and `party` the customer already chosen (an edit). */
export function InvoiceForm({ labelledBy, initial, party, submit, onSubmit }: {
  labelledBy: string; initial: InvoiceInput; party?: { id: string; name: string }; submit: string;
  onSubmit: (values: { partyId: string; businessDate: string; notes: string | null;
    lines: { deliveryLineId: string; qty: string; rate?: string; discountPercent?: string }[] }) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={invoiceSchema} saved={false} messages={INVOICE_MESSAGES} defaultValues={initial}
      onSubmit={(v: InvoiceValues) => onSubmit({
        partyId: v.partyId, businessDate: v.businessDate, notes: v.notes,
        // Only what the contract takes: the form also holds each line's item, to name it.
        lines: v.lines.map((l) => ({
          deliveryLineId: l.deliveryLineId, qty: l.qty,
          ...(l.rate === undefined ? {} : { rate: l.rate }), ...(l.discountPercent === undefined ? {} : { discountPercent: l.discountPercent }),
        })),
      })}>
      <PickedField name="partyId" label={t('sales.party')} hint={t('sales.party.hint')} initial={party ?? null}
        useSearch={useParties} optionLabel={(p) => p.name} />
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      <TextAreaField name="notes" label={t('sales.invoice.notes')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
