'use client';
// The form a delivery return is written in (RAD-125 on RAD-112's contract): a posted delivery, the place the goods go back
// into, a date, notes, and a line for each delivery line coming back, naming the quantity, the batches it goes back into (the
// ones it left with) and, for a serialised item, the serials. What may come back (the quantity not yet invoiced or returned,
// the batches, the serials) is the server's to say: the screen offers what the delivery's own line says it left with, and the
// form is checked with the contract's own schema.
import { listDeliveries, getDelivery } from '@radcore/lib-sales/contract';
import { listLocationKinds, listLocations } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { useController, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { RETURN_MESSAGES } from '../deliveries/shared.tsx';
import { ItemName } from '../shared.tsx';
import { batchKey, returnSchema, type ReturnInput, type ReturnLineInput, type ReturnValues } from './return-values.ts';

/** The places goods can go back into: active places of a kind that sells. A draft's own place is always offered, and the form
 * waits for the places, so an edit keeps it (a select loses its value if its options arrive after it). */
function usePlaces(current: string) {
  const kinds = useApiQuery(listLocationKinds, {});
  const places = useApiList(listLocations, { filter: { status: 'active' } }, { limit: 200 });
  const sells = new Set(kinds.data?.kinds.filter((k) => k.sellable).map((k) => k.kind));
  const options = places.items.filter((l) => kinds.data === undefined || sells.has(l.kind)).map((l) => ({ value: l.id, label: l.name }));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: t('sales.delivery.place.unknown') });
  return { options, ready: !places.isPending && !kinds.isPending };
}

/** Brings a delivery's lines in: a choice among the posted deliveries, and the button that adds its lines. */
function AddDelivery({ append, hasLines }: { append: (lines: ReturnLineInput[]) => void; hasLines: boolean }) {
  const { control, setValue } = useFormContext<ReturnInput>();
  const chosen = useWatch({ control, name: 'deliveryId' });
  const [deliveryId, setDeliveryId] = useState('');
  const deliveries = useApiList(listDeliveries, { filter: { status: 'posted' } });
  const delivery = useApiQuery(getDelivery, { id: deliveryId }, { enabled: deliveryId !== '' }).data;
  // A return takes goods back from one delivery: once its lines are in, another's can't be added until they are removed.
  if (chosen !== '' && hasLines) return null;
  return (
    <div className="kit-field">
      <label htmlFor="return-delivery">{t('sales.return.form.delivery')}</label>
      <p className="kit-field-hint">{t('sales.return.form.delivery.hint')}</p>
      <select id="return-delivery" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}>
        <option value="">{t('sales.return.form.delivery.none')}</option>
        {deliveries.items.map((d) => (
          <option key={d.id} value={d.id}>{t('sales.return.form.delivery.option', { number: d.number ?? '', party: d.partyName })}</option>
        ))}
      </select>
      {deliveries.hasNextPage ? <button type="button" className="kit-button" onClick={deliveries.fetchNextPage}>{t('kit.table.more')}</button> : null}
      <button type="button" className="kit-button" disabled={delivery === undefined}
        onClick={() => {
          if (delivery === undefined) return;
          setValue('deliveryId', delivery.id);
          append(delivery.lines.map((l) => ({ deliveryLineId: l.id, itemId: l.itemId, qty: '', pick: {}, serials: [] })));
          setDeliveryId('');
        }}>{t('sales.return.form.delivery.add')}</button>
    </div>
  );
}

/** The serials of the delivery line, to tick the ones coming back; the quantity follows what is ticked. */
function Serials({ index, serials }: { index: number; serials: readonly string[] }) {
  const { setValue } = useFormContext<ReturnInput>();
  const { field } = useController<ReturnInput, `lines.${number}.serials`>({ name: `lines.${index}.serials` });
  const picked: readonly string[] = field.value;
  return (
    <fieldset>
      <legend>{t('sales.return.form.serials')}</legend>
      <p>{t('sales.return.form.serials.picked', { n: String(picked.length) })}</p>
      <ul className="admin-checklist">
        {serials.map((s) => (
          <li key={s}>
            <label className="admin-grant">
              <input type="checkbox" checked={picked.includes(s)}
                onChange={() => {
                  const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
                  field.onChange(next);
                  if (next.length > 0) setValue(`lines.${index}.qty`, String(next.length));
                }} />
              <span>{s}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** One line's picks, from the delivery line it takes back: a quantity box for each batch it left with, and its serials. */
function Picks({ index, deliveryId, deliveryLineId }: { index: number; deliveryId: string; deliveryLineId: string }) {
  const delivery = useApiQuery(getDelivery, { id: deliveryId }, { enabled: deliveryId !== '' }).data;
  const source = delivery?.lines.find((l) => l.id === deliveryLineId);
  if (source === undefined) return <p>{t('loading')}</p>;
  return (
    <>
      <fieldset>
        <legend>{t('sales.return.form.batches')}</legend>
        <p className="kit-field-hint">{t('sales.return.form.batches.hint')}</p>
        {source.batches.map((b, n) => (
          <TextField key={batchKey(b.batchId)} name={`lines.${index}.pick.${batchKey(b.batchId)}`} inputMode="decimal" autoComplete="off"
            label={t('sales.return.form.batch', {
              batch: b.batchId === null ? t('sales.return.form.batch.unknown') : t('sales.return.form.batch.n', { n: String(n + 1) }),
              left: asWritten(b.qty),
            })} />
        ))}
      </fieldset>
      {source.serials.length === 0 ? null : <Serials index={index} serials={source.serials} />}
    </>
  );
}

// One useFieldArray for the lines, shared with the delivery chooser: a second one on the same name wouldn't see the first's.
function Lines() {
  const { control } = useFormContext<ReturnInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const deliveryId = useWatch({ control, name: 'deliveryId' });
  return (
    <>
      <AddDelivery append={append} hasLines={fields.length > 0} />
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: <ItemName id={f.itemId} /></legend>
          <TextField name={`lines.${i}.qty`} label={t('sales.return.form.line.qty')} inputMode="decimal" autoComplete="off" />
          <Picks index={i} deliveryId={deliveryId} deliveryLineId={f.deliveryLineId} />
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.return.form.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
      {fields.length === 0 ? <p>{t('sales.return.form.lines.none')}</p> : null}
    </>
  );
}

/** The form. `initial` is what it starts from. */
export function ReturnForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: ReturnInput; submit: string; onSubmit: (values: ReturnValues) => Promise<unknown>;
}) {
  const places = usePlaces(initial.locationId);
  if (!places.ready) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={returnSchema} saved={false} messages={RETURN_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <SelectField name="locationId" label={t('sales.return.form.place')} placeholder={t('sales.return.form.place.none')} options={places.options} />
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      <TextAreaField name="notes" label={t('sales.notes')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
