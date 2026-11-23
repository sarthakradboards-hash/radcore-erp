'use client';
// The form a stock adjustment is written in (RAD-144 on RAD-141's contracts): the place, its date and reason, and its lines,
// each an item in or out. Goods going out are picked from what's on hand, by batch and serial, with the delivery form's
// picker (ui-2's StockPick, which reads and writes `locationId` and each line's `qty`, `pick` and `serials`). A found
// serialised unit names its serial, its condition and, where the item keeps one, its chassis number (F22). The server
// judges stock, batches, serials and chassis numbers again as it posts.
import { indiaDate, UNIT_CONDITIONS } from '@radcore/lib-common';
import { createStockAdjustment, getItem, listItems } from '@radcore/lib-stock/contract';
import { useEffect, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { RadioField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { StockPick } from '../../sales/deliveries/stock-pick.tsx';
import { PickedField } from '../../sales/picked-field.tsx';
import { STOCK_MESSAGES, unitsFromText, usePlaces } from '../shared.tsx';

const shape = createStockAdjustment.input.shape;
const contractLine = shape.lines.element;

/** A line as the form holds it, sent as the contract's line: out takes its batches from the picker's boxes and its serials
 * from the units ticked; in takes the units typed, one a line. */
const line = z.object({
  itemId: z.string().min(1, t('stock.line.pick')), direction: z.enum(['in', 'out']), qty: z.string(),
  pick: z.record(z.string(), z.string()), serials: z.array(z.string()), unitsText: z.string(), condition: z.string(),
}).transform((l, ctx) => {
  const batches = l.direction === 'in' ? [] : Object.entries(l.pick).filter(([, qty]) => qty.trim() !== '')
    .map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty: qty.trim() }));
  if (l.direction === 'out' && batches.length === 0) {
    ctx.addIssue({ code: 'custom', message: t('stock.adjustment.err.pick'), path: ['qty'] });
    return z.NEVER;
  }
  const serials = l.direction === 'in' ? unitsFromText(l.unitsText) : l.serials.map((serialNo) => ({ serialNo, chassisNo: null }));
  // A condition is a found unit's: an out line sends none, whatever its box last held (auditor-3 on #352).
  return { itemId: l.itemId, direction: l.direction, qty: l.qty.trim(), batches, serials,
    condition: l.direction === 'in' && l.condition !== '' ? l.condition : null };
}).pipe(contractLine);

const adjustmentSchema = z.object({
  locationId: z.string().min(1, t('stock.place.pick')).pipe(shape.locationId),
  businessDate: shape.businessDate, reason: shape.reason,
  lines: z.array(line).min(1, t('stock.lines.min')).max(200, t('stock.lines.max')),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;
export type AdjustmentValues = z.output<typeof adjustmentSchema>;

const blankAdjustmentLine = (itemId = ''): AdjustmentInput['lines'][number] =>
  ({ itemId, direction: 'out', qty: '', pick: {}, serials: [], unitsText: '', condition: '' });
export const newAdjustment = (): AdjustmentInput => ({ locationId: '', businessDate: indiaDate(new Date()), reason: '', lines: [blankAdjustmentLine()] });

const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

function LineFields({ index, onSplit }: { index: number; onSplit: () => void }) {
  const { control, setValue } = useFormContext<AdjustmentInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const direction = useWatch({ control, name: `lines.${index}.direction` });
  // A new item or direction leaves none of the old one's picks, serials, units or condition (auditor-3 on #352, as #320's
  // ItemBox): not on the first render, so an edit keeps what was saved, and kept when an earlier line is removed.
  const seen = useRef({ itemId, direction });
  useEffect(() => {
    if (seen.current.itemId === itemId && seen.current.direction === direction) return;
    seen.current = { itemId, direction };
    setValue(`lines.${index}.pick`, {});
    setValue(`lines.${index}.serials`, []);
    setValue(`lines.${index}.unitsText`, '');
    setValue(`lines.${index}.condition`, '');
  }, [itemId, direction, index, setValue]);
  const locationId = useWatch({ control, name: 'locationId' });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <>
      <PickedField name={`lines.${index}.itemId`} label={t('stock.line.item')} hint={t('stock.line.item.hint')} initial={item}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      <RadioField name={`lines.${index}.direction`} label={t('stock.adjustment.direction')} options={[
        { value: 'out', label: t('stock.adjustment.direction.out') }, { value: 'in', label: t('stock.adjustment.direction.in') },
      ]} />
      <TextField name={`lines.${index}.qty`} label={t('stock.adjustment.qty')} inputMode="decimal" autoComplete="off" />
      {direction === 'out' ? (
        itemId === '' ? null : locationId === '' ? <p>{t('stock.adjustment.pickPlace')}</p> : <StockPick index={index} itemId={itemId} onSplit={onSplit} />
      ) : (
        <>
          <TextAreaField name={`lines.${index}.unitsText`} label={t('stock.line.serials')} hint={t('stock.serials.inHint')} />
          <SelectField name={`lines.${index}.condition`} label={t('stock.adjustment.condition')} options={[
            { value: '', label: t('stock.adjustment.conditionNone') },
            ...UNIT_CONDITIONS.map((c) => ({ value: c, label: t(`stock.adjustment.condition.${c}`) })),
          ]} />
        </>
      )}
    </>
  );
}

function Lines() {
  const { control, getValues } = useFormContext<AdjustmentInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('stock.line', { n: String(i + 1) })}</legend>
          {/* Units of another condition go on a line of their own, as a delivery's do. */}
          <LineFields index={i} onSplit={() => append(blankAdjustmentLine(getValues(`lines.${i}.itemId`)))} />
          {fields.length > 1 ? <button type="button" className="kit-button" onClick={() => remove(i)}>{t('stock.line.remove', { n: String(i + 1) })}</button> : null}
        </fieldset>
      ))}
      {fields.length < 200 ? <button type="button" className="kit-button" onClick={() => append(blankAdjustmentLine())}>{t('stock.line.add')}</button> : null}
    </>
  );
}

function Place() {
  const { control } = useFormContext<AdjustmentInput>();
  const current = useWatch({ control, name: 'locationId' });
  return <SelectField name="locationId" label={t('stock.place')} placeholder={t('stock.place.pick')} options={usePlaces(current)} />;
}

export function AdjustmentForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: AdjustmentInput; submit: string; onSubmit: (values: AdjustmentValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={adjustmentSchema} saved={false} messages={STOCK_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <Place />
      <TextField name="businessDate" label={t('stock.date')} type="date" />
      <TextAreaField name="reason" label={t('stock.reason')} hint={t('stock.reason.hint')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
