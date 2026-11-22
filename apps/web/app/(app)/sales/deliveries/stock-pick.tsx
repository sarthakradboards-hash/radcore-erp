'use client';
// What a delivery line takes from the place (RAD-125 on #280's getOnHand): the batches the goods come from and, for a
// serialised item, the units. The read is a convenience, never the guard: posting checks every batch and unit again, so
// a stale list can only be refused, never trusted. A serialised line holds units of one condition only (the architect on
// RAD-112), so once a unit is picked the units of another condition can't be: the screen says why, and offers a second line
// for them. The server's own refusal (`mixed_condition`) is worded too, for a line written some other way.
import { UNIT_CONDITIONS } from '@radcore/lib-common';
import { getOnHand } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { useController, useFormContext, useWatch } from 'react-hook-form';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { countByBatch, unlistedKeys, type DeliveryInput } from './delivery-values.ts';

type Condition = (typeof UNIT_CONDITIONS)[number];

/** The key a batch's quantity box has in the form: the batch's id, or "unknown" for goods whose batch isn't known. */
export const batchKey = (batchId: string | null) => batchId ?? 'unknown';

function Units({ index, units, complete }: {
  index: number;
  units: readonly { serialNo: string; chassisNo: string | null; condition: Condition; heldForThis: boolean; batchId: string | null }[];
  /** The whole list is shown (no search, no further page), so a picked unit missing from it isn't on hand here now. */
  complete: boolean;
}) {
  const { setValue } = useFormContext<DeliveryInput>();
  const { field } = useController<DeliveryInput, `lines.${number}.serials`>({ name: `lines.${index}.serials` });
  const picked: readonly string[] = field.value;
  // A picked unit's condition and batch, kept while the list is narrowed by a search and it scrolls out of view.
  const [known] = useState(() => new Map<string, { condition: Condition; batchId: string | null }>());
  for (const u of units) known.set(u.serialNo, { condition: u.condition, batchId: u.batchId });
  const first = picked.map((s) => known.get(s)?.condition).find((c) => c !== undefined);
  const toggle = (serialNo: string) => {
    const next = picked.includes(serialNo) ? picked.filter((s) => s !== serialNo) : [...picked, serialNo];
    field.onChange(next);
    if (next.length === 0) { setValue(`lines.${index}.pick`, {}); return; }
    setValue(`lines.${index}.qty`, String(next.length));
    // Each unit is taken from its own batch, so the batch boxes follow what is ticked. shortcut: only when every ticked unit's
    // batch is known (one saved in a draft and not listed now leaves the boxes as they are), when a draft's own units are listed too.
    const batchOf = next.map((s) => known.get(s));
    if (batchOf.every((k) => k !== undefined)) {
      setValue(`lines.${index}.pick`, countByBatch(batchOf.map((k) => k.batchId)));
    }
  };
  return (
    <>
      <p>{t('sales.delivery.form.serials.picked', { n: String(picked.length) })}</p>
      <ul className="admin-checklist">
        {complete ? picked.filter((s) => !units.some((u) => u.serialNo === s)).map((serialNo) => (
          <li key={serialNo}>
            <label className="admin-grant">
              <input type="checkbox" checked onChange={() => toggle(serialNo)} />
              <span>{serialNo}, {t('sales.delivery.form.notOnHand')}</span>
            </label>
          </li>
        )) : null}
        {units.map((u) => {
          const other = first !== undefined && u.condition !== first && !picked.includes(u.serialNo);
          const label = [u.serialNo, u.chassisNo, t(`sales.delivery.form.condition.${u.condition}`),
            u.heldForThis ? t('sales.delivery.form.serials.held') : null, other ? t('sales.delivery.form.serials.otherCondition') : null]
            .filter((x): x is string => x !== null).join(', ');
          return (
            <li key={u.serialNo}>
              <label className="admin-grant">
                <input type="checkbox" checked={picked.includes(u.serialNo)} disabled={other} onChange={() => toggle(u.serialNo)} />
                <span>{label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** One line's stock: the position, a quantity box for each batch with stock here, and the units of a serialised item. */
export function StockPick({ index, itemId, onSplit }: { index: number; itemId: string; onSplit: () => void }) {
  const { control } = useFormContext<DeliveryInput>();
  const locationId = useWatch({ control, name: 'locationId' });
  const orderLineId = useWatch({ control, name: `lines.${index}.orderLineId` });
  const picks = useWatch({ control, name: `lines.${index}.pick` });
  const [q, setQ] = useState('');
  const ready = locationId !== '' && itemId !== '' && orderLineId !== '';
  const stock = useApiQuery(getOnHand, {
    itemId, locationId, forDocument: `sales_order_lines:${orderLineId}`, ...(q.trim() === '' ? {} : { q: q.trim() }), limit: 200,
  }, { enabled: ready });
  if (locationId === '') return <p>{t('sales.delivery.form.onHand.place')}</p>;
  if (stock.error !== null) {
    // The read failed: the batches can still be written by hand, one box for goods of no known batch and one for each already held.
    const keys = Object.keys(picks).includes('unknown') ? Object.keys(picks) : ['unknown', ...Object.keys(picks)];
    return (
      <>
        <p role="alert" className="kit-form-alert">{t('sales.delivery.form.onHand.error')}</p>
        <fieldset>
          <legend>{t('sales.delivery.form.batches')}</legend>
          {keys.map((key) => (
            <TextField key={key} name={`lines.${index}.pick.${key}`} inputMode="decimal" autoComplete="off"
              label={key === 'unknown' ? t('sales.delivery.form.batch.byHand.unknown') : t('sales.delivery.form.batch.byHand', { n: String(keys.filter((k) => k !== 'unknown').indexOf(key) + 1) })} />
          ))}
        </fieldset>
      </>
    );
  }
  if (stock.data === undefined) return <p>{t('sales.delivery.form.onHand.loading')}</p>;
  const { position, batches, units } = stock.data;
  const unlisted = unlistedKeys(picks, batches.map((b) => batchKey(b.batchId)));
  return (
    <>
      <p>{t('sales.delivery.form.onHand', { n: asWritten(position) })}</p>
      <fieldset>
        <legend>{t('sales.delivery.form.batches')}</legend>
        <p className="kit-field-hint">{t('sales.delivery.form.batches.hint')}</p>
        {batches.map((b) => {
          const name = b.batchNo === null ? t('sales.delivery.form.batch.unknown')
            : b.supplierName === null ? t('sales.delivery.form.batch.no', { no: b.batchNo })
              : t('sales.delivery.form.batch.supplier', { no: b.batchNo, supplier: b.supplierName });
          return (
            <TextField key={batchKey(b.batchId)} name={`lines.${index}.pick.${batchKey(b.batchId)}`} inputMode="decimal" autoComplete="off"
              label={t('sales.delivery.form.batch', { batch: name, n: asWritten(b.qty) })} />
          );
        })}
        {unlisted.map((key) => (
          <TextField key={key} name={`lines.${index}.pick.${key}`} inputMode="decimal" autoComplete="off"
            label={t('sales.delivery.form.batch', { batch: t('sales.delivery.form.batch.gone'), n: '0' })} />
        ))}
      </fieldset>
      {units === null ? null : (
        <fieldset>
          <legend>{t('sales.delivery.form.serials')}</legend>
          <p className="kit-field-hint">{t('sales.delivery.form.serials.hint')}</p>
          <label>
            {t('sales.delivery.form.serials.search')}
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </label>
          {units.items.length === 0 ? <p>{t('sales.delivery.form.serials.none')}</p> : <Units index={index} units={units.items} complete={q.trim() === '' && units.next === null} />}
          <button type="button" className="kit-button" onClick={onSplit}>{t('sales.delivery.form.serials.split')}</button>
        </fieldset>
      )}
    </>
  );
}
