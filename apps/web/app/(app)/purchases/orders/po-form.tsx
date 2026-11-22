'use client';
// The form a purchase order is written in (RAD-143 on RAD-136's contracts): a supplier, a date, when it's expected,
// notes and its lines, one item each with a quantity and a rate before GST. It's checked with the contract's own
// schema, so it refuses what the server would; limits, tax and what's been received are the server's to judge. A placed
// PO keeps its supplier and date (fixed_once_placed): they show as text, and are sent as they were.
import { listParties } from '@radcore/lib-accounts/contract';
import { formatDate, indiaDate } from '@radcore/lib-common';
import { createPurchaseOrder } from '@radcore/lib-purchasing/contract';
import { getItem, listItems } from '@radcore/lib-stock/contract';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { PURCHASE_MESSAGES } from '../shared.tsx';

const shape = createPurchaseOrder.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);

const line = z.object({ itemId: z.string().min(1, t('purchases.line.pick')).pipe(lineShape.itemId), qty: lineShape.qty, rate: lineShape.rate });
const poSchema = z.object({
  supplierId: z.string().min(1, t('purchases.order.supplier.pick')).pipe(shape.supplierId),
  businessDate: shape.businessDate,
  expectedBy: emptyIsNull(shape.expectedBy),
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('purchases.lines.min')).max(200, t('purchases.lines.max')),
}).refine((o) => o.expectedBy === null || o.expectedBy >= o.businessDate, {
  path: ['expectedBy'], error: t('purchases.order.expectedBy.hint'),
});
export type PoValues = z.output<typeof poSchema>;
export type PoInput = z.input<typeof poSchema>;

const blankLine = { itemId: '', qty: '1', rate: '' };
/** What a new PO starts from: today, one empty line. */
export const NEW_PO: PoInput = { supplierId: '', businessDate: indiaDate(new Date()), expectedBy: '', notes: '', lines: [blankLine] };

// The parties a purchase may name (BUYS_FROM_KINDS), switched on.
const useSuppliers = (query: string) => useApiSearch(listParties, query, { params: { filter: { buysFrom: true, active: true } } });
const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

/** One line's item box. It names the item the line's own value holds, so it stays right when a line before it is removed. */
function ItemBox({ index }: { index: number }) {
  const { control } = useFormContext<PoInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <PickedField name={`lines.${index}.itemId`} label={t('purchases.line.item')} hint={t('purchases.line.item.hint')} initial={item}
      useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
  );
}

function Lines() {
  const { control } = useFormContext<PoInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('purchases.line', { n: String(i + 1) })}</legend>
          <ItemBox index={i} />
          <TextField name={`lines.${i}.qty`} label={t('purchases.line.qty')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.rate`} label={t('purchases.line.rate')} inputMode="decimal" autoComplete="off" />
          {fields.length > 1 ? (
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('purchases.line.remove', { n: String(i + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      {fields.length < 200 ? <button type="button" className="kit-button" onClick={() => append(blankLine)}>{t('purchases.line.add')}</button> : null}
    </>
  );
}

/** The form. `supplier` is the one already chosen (an edit). `placed`: the supplier and date are fixed, shown as text. */
export function PoForm({ labelledBy, initial, supplier, placed = false, submit, onSubmit }: {
  labelledBy: string; initial: PoInput; supplier?: { id: string; name: string }; placed?: boolean;
  submit: string; onSubmit: (values: PoValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={poSchema} saved={false} messages={PURCHASE_MESSAGES} defaultValues={initial}
      onSubmit={onSubmit}>
      {placed ? (
        <>
          <p>{t('purchases.order.fixedOnce')}</p>
          <dl className="admin-facts">
            <dt>{t('purchases.order.supplier')}</dt><dd>{supplier?.name}</dd>
            <dt>{t('purchases.order.date')}</dt><dd>{formatDate(initial.businessDate)}</dd>
          </dl>
        </>
      ) : (
        <>
          <PickedField name="supplierId" label={t('purchases.order.supplier')} hint={t('purchases.order.supplier.hint')} initial={supplier ?? null}
            useSearch={useSuppliers} optionLabel={(p) => p.name} />
          <TextField name="businessDate" label={t('purchases.order.date')} type="date" />
        </>
      )}
      <TextField name="expectedBy" label={t('purchases.order.expectedBy')} hint={t('purchases.order.expectedBy.hint')} type="date" />
      <TextAreaField name="notes" label={t('purchases.order.notes')} />
      <Lines />
      <p>{t('purchases.order.rate.note')}</p>
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
