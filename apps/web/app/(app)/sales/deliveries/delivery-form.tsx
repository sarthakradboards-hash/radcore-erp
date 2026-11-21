'use client';
// The form a delivery is written in (RAD-125 on RAD-112's contract and #280's getOnHand): an order, the place the goods go
// out of, a date, notes, and a line for each order line being delivered, each naming the batches (and for a serialised item
// the units) it takes. Choosing an order offers its confirmed lines; the quantity starts as what's left. What may be
// delivered (the quantity left, the place's kind, stock on hand, the credit) is the server's to say; the form is checked
// with the contract's own schema, and what the picker shows is a convenience posting checks again.
import { dec } from '@radcore/lib-common';
import { getOrder, listOrders } from '@radcore/lib-sales/contract';
import { listLocationKinds, listLocations } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { ItemName, SALES_MESSAGES } from '../shared.tsx';
import { deliverySchema, type DeliveryInput, type DeliveryValues, type LineInput } from './delivery-values.ts';
import { StockPick } from './stock-pick.tsx';

/** The places goods can be delivered from: active places of a kind that sells. A person who can't read the kinds (or the
 * places) is offered what they can, and the server refuses a place that isn't one. */
function usePlaces(current: string) {
  const kinds = useApiQuery(listLocationKinds, {});
  const places = useApiList(listLocations, { filter: { status: 'active' } }, { limit: 200 });
  const sells = new Set(kinds.data?.kinds.filter((k) => k.sellable).map((k) => k.kind));
  const options = places.items.filter((l) => kinds.data === undefined || sells.has(l.kind)).map((l) => ({ value: l.id, label: l.name }));
  // A draft's place is offered even if it can't be listed now (switched off, or hidden from this person), so it isn't lost.
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: t('sales.delivery.place.unknown') });
  return { options, ready: !places.isPending && !kinds.isPending };
}

/** Brings an order's lines in: a choice among the confirmed orders, and the button that adds its lines still to deliver. */
function AddOrder({ append, hasLines }: { append: (lines: LineInput[]) => void; hasLines: boolean }) {
  const { control, setValue } = useFormContext<DeliveryInput>();
  const chosen = useWatch({ control, name: 'orderId' });
  const [orderId, setOrderId] = useState('');
  const orders = useApiList(listOrders, { filter: { status: 'confirmed' } });
  const order = useApiQuery(getOrder, { id: orderId }, { enabled: orderId !== '' }).data;
  // A delivery goes against one order: once its lines are in, another order's can't be added until they are removed.
  if (chosen !== '' && hasLines) return null;
  return (
    <div className="kit-field">
      <label htmlFor="delivery-order">{t('sales.delivery.form.order')}</label>
      <p className="kit-field-hint">{t('sales.delivery.form.order.hint')}</p>
      <select id="delivery-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
        <option value="">{t('sales.delivery.form.order.none')}</option>
        {orders.items.map((o) => (
          <option key={o.id} value={o.id}>{t('sales.delivery.form.order.option', { number: o.number ?? '', party: o.partyName })}</option>
        ))}
      </select>
      {orders.hasNextPage ? <button type="button" className="kit-button" onClick={orders.fetchNextPage}>{t('kit.table.more')}</button> : null}
      <button type="button" className="kit-button" disabled={order === undefined}
        onClick={() => {
          if (order === undefined) return;
          setValue('orderId', order.id);
          // What is left to deliver starts the quantity; it is only a suggestion, and the server holds the limit.
          append(order.lines.filter((l) => dec(l.qty).gt(l.delivered)).map((l) => ({
            orderLineId: l.id, itemId: l.itemId, qty: asWritten(dec(l.qty).minus(l.delivered).toString()), pick: {}, serials: [],
          })));
          setOrderId('');
        }}>{t('sales.delivery.form.order.add')}</button>
    </div>
  );
}

/** Names the order the delivery is against once its lines are in. */
function AgainstOrder({ id }: { id: string }) {
  const order = useApiQuery(getOrder, { id }).data;
  return order === undefined ? null : <p>{t('sales.delivery.form.against', { number: order.number ?? '', party: order.partyName })}</p>;
}

// One useFieldArray for the lines, shared with the order chooser: a second one on the same name wouldn't see the first's.
function Lines() {
  const { control } = useFormContext<DeliveryInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const itemIds = useWatch({ control, name: 'lines' });
  const orderId = useWatch({ control, name: 'orderId' });
  return (
    <>
      <AddOrder append={append} hasLines={fields.length > 0} />
      {orderId !== '' && fields.length > 0 ? <AgainstOrder id={orderId} /> : null}
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: <ItemName id={f.itemId} /></legend>
          <TextField name={`lines.${i}.qty`} label={t('sales.delivery.form.line.qty')} inputMode="decimal" autoComplete="off" />
          <StockPick index={i} itemId={itemIds[i]?.itemId ?? f.itemId}
            onSplit={() => append({ orderLineId: f.orderLineId, itemId: f.itemId, qty: '', pick: {}, serials: [] })} />
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.delivery.form.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
      {fields.length === 0 ? <p>{t('sales.delivery.form.lines.none')}</p> : null}
    </>
  );
}

/** The form. `initial` is what it starts from. */
export function DeliveryForm({ labelledBy, initial, submit, onSubmit }: {
  labelledBy: string; initial: DeliveryInput; submit: string;
  onSubmit: (values: DeliveryValues) => Promise<unknown>;
}) {
  const places = usePlaces(initial.locationId);
  // A select's chosen value is lost if its options arrive after it, so the form waits for the places.
  if (!places.ready) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={deliverySchema} saved={false} messages={SALES_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <SelectField name="locationId" label={t('sales.delivery.form.place')} placeholder={t('sales.delivery.form.place.none')} options={places.options} />
      <TextField name="businessDate" label={t('sales.date')} type="date" />
      <TextAreaField name="notes" label={t('sales.notes')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
