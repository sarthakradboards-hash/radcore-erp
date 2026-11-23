'use client';
// The form a stock count is written in (RAD-144 on RAD-141's contracts): the place, when it was counted, its date and
// reason, and what was found, one item and batch a line, with the serials of a serialised item. The server works out the
// book quantity and the difference, and adds up an item and batch listed twice (RC-123); the screen only sends what was
// found. It's checked with the contract's own schema, so it refuses what the server would.
import { indiaDate } from '@radcore/lib-common';
import { createStockCount, getItem, getOnHand, listItems } from '@radcore/lib-stock/contract';
import { useEffect, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { serialsFromText, STOCK_MESSAGES, usePlaces } from '../shared.tsx';

const shape = createStockCount.input.shape;
const lineShape = shape.lines.element.shape;

/** The moment a datetime box holds (the browser's own time), as the UTC moment the contract takes. */
const localMoment = z.string().min(1, t('stock.count.countedAt.hint')).transform((s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}).pipe(shape.countedAt);
/** Now, as a datetime box shows it in the browser's own time. */
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

const line = z.object({
  itemId: z.string().min(1, t('stock.line.pick')).pipe(lineShape.itemId),
  batchId: z.string().transform((s) => (s === '' ? null : s)).pipe(lineShape.batchId),
  qty: lineShape.qty,
  serials: z.string().transform(serialsFromText).pipe(lineShape.serials),
});
const countSchema = z.object({
  locationId: z.string().min(1, t('stock.place.pick')).pipe(shape.locationId),
  countedAt: localMoment,
  businessDate: shape.businessDate,
  reason: shape.reason,
  lines: z.array(line).min(1, t('stock.lines.min')).max(200, t('stock.lines.max')),
});
export type CountInput = z.input<typeof countSchema>;
export type CountValues = z.output<typeof countSchema>;

const blankLine = { itemId: '', batchId: '', qty: '', serials: '' };
export const newCount = (): CountInput => ({ locationId: '', countedAt: nowLocal(), businessDate: indiaDate(new Date()), reason: '', lines: [blankLine] });
/** A stored moment as a datetime box shows it, in the browser's own time. */
export const asLocal = (moment: string) => { const d = new Date(moment); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

function ItemBox({ index }: { index: number }) {
  const { control } = useFormContext<CountInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <PickedField name={`lines.${index}.itemId`} label={t('stock.line.item')} hint={t('stock.line.item.hint')} initial={item}
      useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
  );
}

/** The batch a line counts: one with stock at the place in the books, or none named. A convenience: the server checks it's
 * the item's (unknown_batch). */
function BatchBox({ index }: { index: number }) {
  const { control, setValue } = useFormContext<CountInput>();
  const locationId = useWatch({ control, name: 'locationId' });
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const current = useWatch({ control, name: `lines.${index}.batchId` });
  // A new item leaves no batch of the old one (auditor-3 on #352): not on the first render, so an edit keeps its batch.
  const seenItem = useRef(itemId);
  useEffect(() => {
    if (seenItem.current === itemId) return;
    seenItem.current = itemId;
    setValue(`lines.${index}.batchId`, '');
  }, [itemId, index, setValue]);
  const onHand = useApiQuery(getOnHand, { itemId, locationId, limit: 1 }, { enabled: itemId !== '' && locationId !== '' }).data;
  const named = (onHand?.batches ?? []).filter((b) => b.batchId !== null).map((b) => ({ value: b.batchId as string, label: b.batchNo ?? '' }));
  if (current !== '' && !named.some((o) => o.value === current)) named.push({ value: current, label: t('stock.line.batch') });
  return <SelectField name={`lines.${index}.batchId`} label={t('stock.line.batch')} options={[{ value: '', label: t('stock.batch.none') }, ...named]} />;
}

function Lines() {
  const { control } = useFormContext<CountInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      <p>{t('stock.count.merge')}</p>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('stock.line', { n: String(i + 1) })}</legend>
          <ItemBox index={i} />
          <BatchBox index={i} />
          <TextField name={`lines.${i}.qty`} label={t('stock.count.found')} inputMode="decimal" autoComplete="off" />
          <TextAreaField name={`lines.${i}.serials`} label={t('stock.line.serials')} hint={t('stock.serials.hint')} />
          {fields.length > 1 ? <button type="button" className="kit-button" onClick={() => remove(i)}>{t('stock.line.remove', { n: String(i + 1) })}</button> : null}
        </fieldset>
      ))}
      {fields.length < 200 ? <button type="button" className="kit-button" onClick={() => append(blankLine)}>{t('stock.line.add')}</button> : null}
    </>
  );
}

function Place() {
  const { control } = useFormContext<CountInput>();
  const current = useWatch({ control, name: 'locationId' });
  return <SelectField name="locationId" label={t('stock.place')} placeholder={t('stock.place.pick')} options={usePlaces(current)} />;
}

export function CountForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: CountInput; submit: string; onSubmit: (values: CountValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={countSchema} saved={false} messages={STOCK_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <Place />
      <TextField name="countedAt" label={t('stock.count.countedAt')} hint={t('stock.count.countedAt.hint')} type="datetime-local" />
      <TextField name="businessDate" label={t('stock.date')} type="date" />
      <TextAreaField name="reason" label={t('stock.reason')} hint={t('stock.reason.hint')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
