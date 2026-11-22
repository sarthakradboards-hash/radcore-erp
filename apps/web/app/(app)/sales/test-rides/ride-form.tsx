'use client';
// The form a test ride is scheduled in (RAD-127 on RAD-117's contract): a lead, the model and the demo unit, and when. The unit is
// typed as a serial number; with a place chosen, the demo units on hand there are offered to pick from, a convenience the server
// checks again (`not_demo`). The read is the stock-by-place one (stock:read): a person without it can still type the serial number.
import { listLeads } from '@radcore/lib-crm/contract';
import { getOnHand, listItems } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { usePlaces } from '../deliveries/shared.tsx';
import { PickedField } from '../picked-field.tsx';
import { rideSchema, type RideInput, type RideValues } from './ride-values.ts';
import { RIDE_MESSAGES } from './shared.ts';

const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

/** The leads to choose from (leads:read): by name, with the phone as masked as the list gives it. */
function LeadField() {
  const leads = useApiList(listLeads, { filter: {} });
  return (
    <>
      <SelectField name="leadId" label={t('sales.ride.form.lead')} hint={t('sales.ride.form.lead.hint')} placeholder={t('sales.ride.form.lead.none')}
        options={leads.items.map((l) => ({ value: l.id, label: t('sales.ride.form.lead.option', { name: l.name ?? t('sales.ride.form.lead.unnamed'), phone: l.phone.masked }) }))} />
      {leads.hasNextPage ? <button type="button" className="kit-button" onClick={leads.fetchNextPage}>{t('kit.table.more')}</button> : null}
      {!leads.isPending && leads.items.length === 0 ? <p>{t('sales.ride.form.lead.empty')}</p> : null}
    </>
  );
}

/** The serial number, and the demo units at a place to pick it from. */
function Units() {
  const { control, setValue } = useFormContext<RideInput>();
  const itemId = useWatch({ control, name: 'itemId' });
  const places = usePlaces('');
  const [place, setPlace] = useState('');
  const stock = useApiQuery(getOnHand, { itemId, locationId: place, limit: 200 }, { enabled: place !== '' && itemId !== '' });
  const demo = (stock.data?.units?.items ?? []).filter((u) => u.condition === 'demo');
  return (
    <>
      <TextField name="serialNo" label={t('sales.ride.form.serial')} hint={t('sales.ride.form.serial.hint')} autoComplete="off" />
      {itemId === '' || !places.ready ? null : (
        <div className="kit-field">
          <label htmlFor="ride-place">{t('sales.ride.form.place')}</label>
          <select id="ride-place" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">{t('sales.ride.form.place.none')}</option>
            {places.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {place === '' || itemId === '' ? null : stock.error !== null ? <p role="alert" className="kit-form-alert">{t('sales.ride.form.units.error')}</p> : (
        <fieldset>
          <legend>{t('sales.ride.form.units')}</legend>
          {stock.data !== undefined && demo.length === 0 ? <p>{t('sales.ride.form.units.none')}</p> : null}
          <ul className="admin-checklist">
            {demo.map((u) => (
              <li key={u.serialNo}>
                <button type="button" className="kit-button" onClick={() => setValue('serialNo', u.serialNo, { shouldValidate: true })}>
                  {t('sales.ride.form.unit.pick', { serial: u.serialNo })}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </>
  );
}

/** The form. */
export function RideForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: RideInput; submit: string; onSubmit: (values: RideValues) => Promise<unknown>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={rideSchema} saved={false} messages={RIDE_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <LeadField />
      <PickedField name="itemId" label={t('sales.ride.form.item')} hint={t('sales.ride.form.item.hint')} initial={null}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      <Units />
      <TextField name="scheduledAt" label={t('sales.ride.form.when')} hint={t('sales.ride.form.when.hint')} type="datetime-local" />
      <TextAreaField name="note" label={t('sales.ride.form.note')} />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
