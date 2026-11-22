'use client';
// The counter's quick bill form (RAD-124 on RAD-115's contract): the place the goods leave from, who it is for (the Counter customer
// by default, or a named customer), the lines (a type-ahead item box that also takes a scanned barcode, quantity, rate, discount,
// and the batches and serials the goods come from) and the payments, split as the customer pays: cash, UPI, or a card by its
// approval code alone. What the bill totals, the tax, whether it needs an approval, the day's cash limit and what is left unpaid
// are the server's to work out and refuse; this form only fills the contract in and words what comes back.
import { dec, formatMoney, indiaDate, moneyString, sum } from '@radcore/lib-common';
import { getPartyStatement, listMoneyAccounts, listParties } from '@radcore/lib-accounts/contract';
import { getSalePrice } from '@radcore/lib-sales/contract';
import { getItem, listItems } from '@radcore/lib-stock/contract';
import { useEffect, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { RadioField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice } from '../../admin/decimal.ts';
import { usePlaces } from '../deliveries/shared.tsx';
import { StockPick } from '../deliveries/stock-pick.tsx';
import { PickedField } from '../picked-field.tsx';
import {
  blankLine, blankPayment, PAYMENT_METHODS, quickBillSchema, rateAfterPrice, type QuickBillInput, type QuickBillValues,
} from './quick-bill-values.ts';
import { QUICK_BILL_MESSAGES } from './shared.ts';

const useParties = (query: string) => useApiSearch(listParties, query, { params: { filter: { sellsTo: true, active: true } } });
const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

/** What the named customer owes today, from To collect's statement (receivables:read); a person without that key sees nothing of it.
 * What a customer may owe is the server's to judge when the bill is saved. */
function Balance({ partyId }: { partyId: string }) {
  const may = useMe().permissions.includes('receivables:read');
  const today = indiaDate(new Date());
  const owed = useApiQuery(getPartyStatement, { id: partyId, from: today, to: today }, { enabled: may && partyId !== '' }).data?.toCollect;
  if (!may || owed === undefined) return null;
  if (dec(owed.outstanding).lt(0)) return <p>{t('sales.quick.balance.credit', { amount: formatMoney(dec(owed.outstanding).neg().toString()) })}</p>;
  if (!dec(owed.outstanding).gt(0)) return <p>{t('sales.quick.balance.none')}</p>;
  return (
    <p>
      {t('sales.quick.balance.owes', { outstanding: formatMoney(owed.outstanding) })}
      {dec(owed.overdue).gt(0) ? ` ${t('sales.quick.balance.overdue', { overdue: formatMoney(owed.overdue) })}` : ''}
    </p>
  );
}

/** The named customer's box, shown when the bill is for a named customer, with what they owe. */
function PartyBox() {
  const { control } = useFormContext<QuickBillInput>();
  const customer = useWatch({ control, name: 'customer' });
  const partyId = useWatch({ control, name: 'partyId' });
  if (customer !== 'named') return null;
  return (
    <>
      <PickedField name="partyId" label={t('sales.quick.party')} hint={t('sales.quick.party.hint')} initial={null} useSearch={useParties} optionLabel={(p) => p.name} />
      <Balance partyId={partyId} />
    </>
  );
}

/** One line's item box. It names the item the line's own value holds, so it stays right when a line before it is removed. */
function ItemBox({ index }: { index: number }) {
  const { control, setValue, getValues } = useFormContext<QuickBillInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const customer = useWatch({ control, name: 'customer' });
  const partyId = useWatch({ control, name: 'partyId' });
  const on = useWatch({ control, name: 'businessDate' });
  // The rate comes from the item's price list for this customer and day (prices:read); a person without that key types the rate. A list
  // rate that includes GST isn't put in the box, which takes the rate before GST. The box remembers what it filled in: when the list
  // rate changes (another item, customer or day) that is replaced, but a rate someone typed is never touched.
  const mayPrice = useMe().permissions.includes('prices:read');
  const price = useApiQuery(getSalePrice, { itemId, ...(customer === 'named' && partyId !== '' ? { partyId } : {}), on },
    { enabled: mayPrice && itemId !== '' && /^\d{4}-\d{2}-\d{2}$/.test(on) }).data;
  const listRate = price?.rate != null && price.taxInclusive === false ? asPrice(price.rate) : null;
  const filled = useRef<string | null>(null);
  useEffect(() => {
    const next = rateAfterPrice(getValues(`lines.${index}.rate`), filled.current, listRate);
    filled.current = next.filled;
    if (next.rate !== getValues(`lines.${index}.rate`)) setValue(`lines.${index}.rate`, next.rate);
  }, [listRate, index, getValues, setValue]);
  // What was picked for one item is not for another: a new item leaves no batches or serials of the old one (auditor-3 on #320). Not on
  // the first render, and kept when an earlier line is removed (this box stays with its own line, whose item is the same).
  const itemSeen = useRef(itemId);
  useEffect(() => {
    if (itemSeen.current !== itemId) {
      setValue(`lines.${index}.pick`, {});
      setValue(`lines.${index}.serials`, []);
      // The rate was for the old item, filled or typed: the new item's list rate (if any) fills it again.
      setValue(`lines.${index}.rate`, '');
      filled.current = null;
    }
    itemSeen.current = itemId;
  }, [itemId, index, setValue]);
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <>
      <PickedField name={`lines.${index}.itemId`} label={t('sales.quick.line.item')} hint={t('sales.quick.line.item.hint')} initial={item}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      {price?.taxInclusive === true ? <p>{t('sales.quick.line.rate.inclusive')}</p> : null}
    </>
  );
}

function Lines() {
  const { control, getValues } = useFormContext<QuickBillInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = useWatch({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('sales.quick.line', { n: String(i + 1) })}</legend>
          <ItemBox index={i} />
          <TextField name={`lines.${i}.qty`} label={t('sales.quick.line.qty')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.rate`} label={t('sales.quick.line.rate')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.discountPercent`} label={t('sales.quick.line.discount')} inputMode="decimal" autoComplete="off" />
          <StockPick index={i} itemId={lines[i]?.itemId ?? ''} onSplit={() => { const here = getValues(`lines.${i}`); append({ ...blankLine, itemId: here.itemId, rate: here.rate, discountPercent: here.discountPercent }); }} />
          {fields.length > 1 ? (
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.quick.line.remove', { n: String(i + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" className="kit-button" onClick={() => append(blankLine)}>{t('sales.quick.line.add')}</button>
      <p>{t('sales.quick.rate.note')}</p>
    </>
  );
}

/** The accounts a UPI payment is paid into: the money accounts that are not cash (GET /money-accounts, money_accounts:read), or 'hidden'
 * when the person can't read them. */
function useUpiAccounts(): { value: string; label: string }[] | 'hidden' {
  const q = useApiQuery(listMoneyAccounts, {});
  if (q.error !== null) return 'hidden';
  return (q.data?.items ?? []).filter((a) => !a.cash).map((a) => ({ value: a.id, label: a.name }));
}

/** What the payments entered add up to: a figure for the person at the till, not the bill's total (the server works that out). */
function PaymentsTotal() {
  const { control } = useFormContext<QuickBillInput>();
  const payments = useWatch({ control, name: 'payments' });
  const amounts = payments.map((p) => p.amount.trim()).filter((a) => moneyString().safeParse(a).success);
  return amounts.length === 0 ? <p>{t('sales.quick.payments.none')}</p> : <p>{t('sales.quick.payments.total', { amount: formatMoney(sum(amounts)) })}</p>;
}

function Payments() {
  const { control } = useFormContext<QuickBillInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'payments' });
  const payments = useWatch({ control, name: 'payments' });
  const accounts = useUpiAccounts();
  return (
    <fieldset>
      <legend>{t('sales.quick.payments')}</legend>
      <p className="kit-field-hint">{t('sales.quick.payments.hint')}</p>
      {fields.map((f, i) => {
        const method = payments[i]?.method ?? f.method;
        return (
          <fieldset key={f.id}>
            <legend>{t('sales.quick.payment', { n: String(i + 1) })}: {t(`sales.quick.payment.method.${method}`)}</legend>
            <TextField name={`payments.${i}.amount`} label={t('sales.quick.payment.amount')} inputMode="decimal" autoComplete="off" />
            {method === 'upi' ? (
              <>
                <SelectField name={`payments.${i}.accountId`} label={t('sales.quick.payment.account')} placeholder={t('sales.quick.payment.account.none')} options={accounts === 'hidden' ? [] : accounts} />
                <TextField name={`payments.${i}.reference`} label={t('sales.quick.payment.reference')} autoComplete="off" />
              </>
            ) : null}
            {method === 'card' ? (
              <TextField name={`payments.${i}.approvalCode`} label={t('sales.quick.payment.approval')} hint={t('sales.quick.payment.approval.hint')} autoComplete="off" />
            ) : null}
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('sales.quick.payment.remove', { n: String(i + 1) })}</button>
          </fieldset>
        );
      })}
      <PaymentsTotal />
      <div className="kit-actions">
        {PAYMENT_METHODS.filter((m) => m !== 'upi' || accounts !== 'hidden').map((m) => (
          <button key={m} type="button" className="kit-button" onClick={() => append(blankPayment(m))}>{t(`sales.quick.payment.add.${m}`)}</button>
        ))}
      </div>
      {accounts === 'hidden' ? <p>{t('sales.quick.payment.upi.hidden')}</p> : null}
    </fieldset>
  );
}

/** The form. */
export function QuickBillForm({ labelledBy, initial, onSubmit }: {
  labelledBy: string; initial: QuickBillInput; onSubmit: (values: QuickBillValues) => Promise<unknown>;
}) {
  const places = usePlaces('');
  // A select's chosen value is lost if its options arrive after it, so the form waits for the places.
  if (!places.ready) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={quickBillSchema} saved={false} messages={QUICK_BILL_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <TextField name="businessDate" label={t('sales.quick.date')} type="date" />
      <SelectField name="locationId" label={t('sales.quick.place')} placeholder={t('sales.quick.place.none')} options={places.options} />
      <RadioField name="customer" label={t('sales.quick.customer')} options={[
        { value: 'counter', label: t('sales.quick.customer.counter') }, { value: 'named', label: t('sales.quick.customer.named') },
      ]} />
      <PartyBox />
      <TextAreaField name="notes" label={t('sales.quick.notes')} />
      <Lines />
      <Payments />
      <SubmitButton>{t('sales.quick.save')}</SubmitButton>
    </Form>
  );
}
