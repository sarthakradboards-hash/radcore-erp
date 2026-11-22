'use client';
// The form a quote or an order is written in (RAD-125): a customer, a date, notes and its lines, one item each with a
// quantity, a rate before GST and a discount. A quote also takes the date it's valid until. The form is checked with the
// contract's own schema, so it refuses what the server would; credit, price and status are the server's to judge.
import { listParties } from '@radcore/lib-accounts/contract';
import { indiaDate } from '@radcore/lib-common';
import { createQuote } from '@radcore/lib-sales/contract';
import { getItem, listItems } from '@radcore/lib-stock/contract';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { TextAreaField, TextField } from '../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';
import { PickedField } from './picked-field.tsx';
import { SALES_MESSAGES } from './shared.tsx';

const shape = createQuote.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);

const line = z.object({
  itemId: z.string().min(1, t('sales.line.pick')).pipe(lineShape.itemId),
  qty: lineShape.qty, rate: lineShape.rate, discountPercent: lineShape.discountPercent,
});
/** A document as the form writes it; an order leaves out `validUntil` when it sends. */
const documentSchema = z.object({
  partyId: z.string().min(1, t('sales.party.pick')).pipe(shape.partyId),
  businessDate: shape.businessDate,
  validUntil: emptyIsNull(shape.validUntil),
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('sales.lines.min')).max(200, t('sales.lines.max')),
});
export type DocumentValues = z.output<typeof documentSchema>;
export type DocumentInput = z.input<typeof documentSchema>;

const blankLine = { itemId: '', qty: '1', rate: '', discountPercent: '0' };
/** What a new document starts from: today, one empty line. */
export const NEW_DOCUMENT: DocumentInput = { partyId: '', businessDate: indiaDate(new Date()), validUntil: '', notes: '', lines: [blankLine] };

const useParties = (query: string) => useApiSearch(listParties, query, { params: { filter: { sellsTo: true, active: true } } });
const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

/** One line's item box. It names the item the line's own value holds, so it stays right when a line before it is removed. */
function ItemBox({ index }: { index: number }) {
  const { control } = useFormContext<DocumentInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <PickedField name={`lines.${index}.itemId`} label={t('sales.line.item')} hint={t('sales.line.item.hint')} initial={item}
      useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
  );
}

function Lines() {
  const { control } = useFormContext<DocumentInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}</legend>
          <ItemBox index={i} />
          <TextField name={`lines.${i}.qty`} label={t('sales.line.qty')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.rate`} label={t('sales.line.rate')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.discountPercent`} label={t('sales.line.discount')} inputMode="decimal" autoComplete="off" />
          {fields.length > 1 ? (
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.line.remove', { n: String(i + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" className="kit-button" onClick={() => append(blankLine)}>{t('sales.line.add')}</button>
    </>
  );
}

/** The form. `initial` is what it starts from; `party` is the customer already chosen (an edit). `quote` adds the valid-until
 * date. */
export function DocumentForm({ labelledBy, initial, party, quote, submit, onSubmit }: {
  labelledBy: string; initial: DocumentInput; party?: { id: string; name: string }; quote: boolean;
  submit: string; onSubmit: (values: DocumentValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={documentSchema} saved={false} messages={SALES_MESSAGES} defaultValues={initial}
      onSubmit={onSubmit}>
      <PickedField name="partyId" label={t('sales.party')} hint={t('sales.party.hint')} initial={party ?? null}
        useSearch={useParties} optionLabel={(p) => p.name} />
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      {quote ? <TextField name="validUntil" label={t('sales.quote.validUntil')} type="date" /> : null}
      <TextAreaField name="notes" label={t('sales.notes')} />
      <Lines />
      <p>{t('sales.rate.note')}</p>
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
