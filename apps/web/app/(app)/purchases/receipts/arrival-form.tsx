'use client';
// The form an arrival is written in (RAD-143 on RAD-137's contracts): a placed purchase order, where the accepted goods and the rejects
// will go, the date, the supplier's own number and a line for each order line that came, with how much. Choosing an order offers its
// lines with what is left to come as the quantity to start from. What may be received (the quantity left, the places' kinds, the
// order being placed) is the server's to say; the form is checked with the contract's own schema.
import { dec } from '@radcore/lib-common';
import { getPurchaseOrder, listPurchaseOrders } from '@radcore/lib-purchasing/contract';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton, useFieldName } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { arrivalSchema, leftToCome, orderLineInfo, type ArrivalInput, type ArrivalLine, type ArrivalValues } from './arrival-values.ts';
import { RECEIPT_MESSAGES, usePlaceChoices } from './shared.tsx';

/** Brings an order's lines in: a choice among the placed orders, and the button that adds its lines. */
function AddOrder({ append, hasLines, fixed }: { append: (lines: ArrivalLine[]) => void; hasLines: boolean; fixed: boolean }) {
  const { control, setValue, getFieldState, formState } = useFormContext<ArrivalInput>();
  // The chooser is a field of the form (its error shows here, not as the kit's "report it" alert for a name nothing shows).
  useFieldName('orderId');
  const chosen = useWatch({ control, name: 'orderId' });
  const [picked, setPicked] = useState('');
  // A change keeps the draft's order: only its own lines can be brought back.
  const orderId = fixed ? chosen : picked;
  const error = getFieldState('orderId', formState).error?.message;
  const orders = useApiList(listPurchaseOrders, { filter: { status: 'placed' } });
  const order = useApiQuery(getPurchaseOrder, { id: orderId }, { enabled: orderId !== '' }).data;
  // An arrival is against one order: once its lines are in, another order's can't be added until they are removed.
  if (chosen !== '' && hasLines) return null;
  return (
    <div className="kit-field">
      {fixed ? <p>{t('inward.form.order.fixed')}</p> : (
        <>
          <label htmlFor="arrival-order">{t('inward.form.order')}</label>
          <p id="arrival-order-hint" className="kit-field-hint">{t('inward.form.order.hint')}</p>
          <select id="arrival-order" value={picked} onChange={(e) => setPicked(e.target.value)} aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? 'arrival-order-hint' : 'arrival-order-hint arrival-order-error'}>
            <option value="">{t('inward.form.order.none')}</option>
            {orders.items.map((o) => (
              <option key={o.id} value={o.id}>{t('inward.form.order.option', { number: o.number ?? '', supplier: o.supplierName })}</option>
            ))}
          </select>
          {error === undefined ? null : <p id="arrival-order-error" className="kit-field-error">{error}</p>}
          {orders.error !== null ? <p role="alert" className="kit-form-alert">{t('inward.form.err.read')}</p> : null}
          {orders.hasNextPage ? <button type="button" className="kit-button" onClick={orders.fetchNextPage}>{t('kit.table.more')}</button> : null}
        </>
      )}
      <button type="button" className="kit-button" disabled={order === undefined}
        onClick={() => {
          if (order === undefined) return;
          setValue('orderId', order.id);
          append(order.lines.filter((l) => dec(l.qty).gt(l.received)).map((l) => ({
            orderLineId: l.id, label: `${l.name} (${l.sku})`, received: leftToCome(l.qty, l.received),
            info: orderLineInfo(order, l.id),
          })));
          setPicked('');
        }}>{t('inward.form.order.add')}</button>
    </div>
  );
}

/** Names the order the arrival is against once its lines are in. */
function AgainstOrder({ id }: { id: string }) {
  const order = useApiQuery(getPurchaseOrder, { id }).data;
  return order === undefined ? null : <p>{t('inward.form.against', { number: order.number ?? '', supplier: order.supplierName })}</p>;
}

// One useFieldArray for the lines, shared with the order chooser: a second one on the same name wouldn't see the first's.
function Lines({ fixed }: { fixed: boolean }) {
  const { control, getFieldState, formState } = useFormContext<ArrivalInput>();
  // `lines` is a field of the form too: the error for no line shows on the note below, never as the "report it" alert.
  useFieldName('lines');
  const linesError = getFieldState('lines', formState).error?.message;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const orderId = useWatch({ control, name: 'orderId' });
  return (
    <>
      <AddOrder append={append} hasLines={fields.length > 0} fixed={fixed} />
      {orderId !== '' && fields.length > 0 ? <AgainstOrder id={orderId} /> : null}
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.line', { n: String(i + 1) })}: {f.label}</legend>
          <TextField name={`lines.${i}.received`} label={t('inward.form.line.received')} hint={f.info === '' ? undefined : f.info}
            inputMode="decimal" autoComplete="off" />
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('inward.form.remove', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
      {fields.length === 0 ? <p>{t('inward.form.order.none.lines')}</p> : null}
      {linesError === undefined ? null : <p className="kit-field-error">{linesError}</p>}
    </>
  );
}

/** The form. `initial` is what it starts from. */
export function ArrivalForm({ labelledBy, initial, submit, fixedOrder = false, onSubmit }: {
  labelledBy: string; initial: ArrivalInput; submit: string; fixedOrder?: boolean; onSubmit: (values: ArrivalValues) => Promise<unknown>;
}) {
  const accepted = usePlaceChoices(initial.locationId, 'sellable');
  const rejects = usePlaceChoices(initial.rejectsLocationId, 'rejected');
  // A select's chosen value is lost if its options arrive after it, so the form waits for the places.
  if (!accepted.ready || !rejects.ready) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={arrivalSchema} saved={false} messages={RECEIPT_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <p>{t('inward.form.intro')}</p>
      <TextField name="businessDate" label={t('inward.form.date')} type="date" />
      <SelectField name="locationId" label={t('inward.form.place')} placeholder={t('inward.form.place.none')} options={accepted.options} />
      <SelectField name="rejectsLocationId" label={t('inward.form.rejects')} hint={t('inward.form.rejects.hint')}
        placeholder={t('inward.form.place.none')} options={rejects.options} />
      <TextField name="supplierRef" label={t('inward.form.supplierRef')} hint={t('inward.form.supplierRef.hint')} autoComplete="off" />
      <TextAreaField name="notes" label={t('inward.form.notes')} />
      <Lines fixed={fixedOrder} />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
