'use client';
// The form a booking is written in (RAD-127 on RAD-117's contract): a confirmed order and its one-vehicle line, the unit, and the
// advance. The unit is typed as a serial number; with a place chosen, the units on hand there (with what is promised to this
// order line) are offered to pick from, a convenience the server checks again (unit_held, unit_unavailable). The read is the
// stock-by-place one (stock:read): a person without it can still type the serial number.
import { dec } from '@radcore/lib-common';
import { getOrder, listOrders } from '@radcore/lib-sales/contract';
import { getOnHand } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { usePlaces } from '../deliveries/shared.tsx';
import { useMoneyAccounts } from '../money-accounts.ts';
import { bookingSchema, type BookingInput, type BookingValues } from './booking-values.ts';
import { BOOKING_MESSAGES } from './shared.ts';

/** The serial number, and the units at a place to pick it from. */
function Units({ itemId, orderLineId }: { itemId: string; orderLineId: string }) {
  const { setValue } = useFormContext<BookingInput>();
  const places = usePlaces('');
  const [place, setPlace] = useState('');
  const stock = useApiQuery(getOnHand, { itemId, locationId: place, forDocument: `sales_order_lines:${orderLineId}`, limit: 200 }, { enabled: place !== '' });
  const units = stock.data?.units?.items ?? [];
  return (
    <>
      <TextField name="serialNo" label={t('sales.booking.form.serial')} hint={t('sales.booking.form.serial.hint')} autoComplete="off" />
      {!places.ready ? null : (
        <div className="kit-field">
          <label htmlFor="booking-place">{t('sales.booking.form.place')}</label>
          <select id="booking-place" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">{t('sales.booking.form.place.none')}</option>
            {places.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {place === '' ? null : stock.error !== null ? <p role="alert" className="kit-form-alert">{t('sales.booking.form.units.error')}</p> : (
        <fieldset>
          <legend>{t('sales.booking.form.units')}</legend>
          {stock.data !== undefined && units.length === 0 ? <p>{t('sales.booking.form.units.none')}</p> : null}
          <ul className="admin-checklist">
            {units.map((u) => (
              <li key={u.serialNo}>
                <button type="button" className="kit-button" onClick={() => setValue('serialNo', u.serialNo, { shouldValidate: true })}>
                  {t('sales.booking.form.unit.pick', { serial: u.serialNo })}
                </button>
                {' '}{t('sales.booking.form.unit', { serial: u.chassisNo ?? u.serialNo, condition: t(`sales.delivery.form.condition.${u.condition}`) })}
                {u.heldForThis ? `, ${t('sales.booking.form.unit.held')}` : ''}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </>
  );
}

/** The order and its line: the line is the form's value; the order only narrows the choice. */
function OrderLine() {
  const { control } = useFormContext<BookingInput>();
  const orderLineId = useWatch({ control, name: 'orderLineId' });
  const [orderId, setOrderId] = useState('');
  const orders = useApiList(listOrders, { filter: { status: 'confirmed' } });
  const order = useApiQuery(getOrder, { id: orderId }, { enabled: orderId !== '' }).data;
  // A booking holds one unit: only a line of quantity 1 can be booked.
  const lines = order?.lines.filter((l) => dec(l.qty).eq(1)) ?? [];
  const itemId = lines.find((l) => l.id === orderLineId)?.itemId;
  return (
    <>
      <div className="kit-field">
        <label htmlFor="booking-order">{t('sales.booking.form.order')}</label>
        <p className="kit-field-hint">{t('sales.booking.form.order.hint')}</p>
        <select id="booking-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">{t('sales.booking.form.order.none')}</option>
          {orders.items.map((o) => (
            <option key={o.id} value={o.id}>{t('sales.booking.form.order.option', { number: o.number ?? '', party: o.partyName })}</option>
          ))}
        </select>
        {orders.hasNextPage ? <button type="button" className="kit-button" onClick={orders.fetchNextPage}>{t('kit.table.more')}</button> : null}
        {!orders.isPending && orders.items.length === 0 ? <p>{t('sales.booking.form.order.none.left')}</p> : null}
      </div>
      {order !== undefined && lines.length === 0 ? <p>{t('sales.booking.form.line.empty')}</p> : null}
      {lines.length === 0 ? null : (
        <SelectField name="orderLineId" label={t('sales.booking.form.line')} placeholder={t('sales.booking.form.line.none')}
          options={lines.map((l) => ({ value: l.id, label: t('sales.booking.form.line.option', { name: l.name, sku: l.sku }) }))} />
      )}
      {itemId === undefined ? null : <Units itemId={itemId} orderLineId={orderLineId} />}
    </>
  );
}

/** The form. */
export function BookingForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: BookingInput; submit: string; onSubmit: (values: BookingValues) => Promise<unknown>;
}) {
  const accounts = useMoneyAccounts();
  return (
    <Form aria-labelledby={labelledBy} schema={bookingSchema} saved={false} messages={BOOKING_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <OrderLine />
      <fieldset>
        <legend>{t('sales.booking.form.advance')}</legend>
        <p className="kit-field-hint">{t('sales.booking.form.advance.hint')}</p>
        <TextField name="amount" label={t('sales.booking.advance.amount')} inputMode="decimal" autoComplete="off" />
        {accounts === 'hidden' ? <p>{t('sales.booking.advance.account.hidden')}</p> : (
          <SelectField name="accountId" label={t('sales.booking.advance.account')} placeholder={t('sales.booking.advance.account.none')} options={accounts ?? []} />
        )}
        <TextField name="businessDate" label={t('sales.booking.advance.date')} type="date" />
      </fieldset>
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
