'use client';
// What the quick bill form adds for hold, then complete (RAD-124 on RAD-115's contracts): the bill's figures as the server would
// make them (a preview, called as the bill changes), the choice to hold the bill for an approval when a check needs one, and the
// walk-in who leaves a balance (a name and mobile, and the address a big bill needs), under sales:counter_credit. Nothing is worked
// out here: the total, the tax, the round-off, what the payments leave and which checks need an approval are the preview's; whether a
// hold may be made, and a buyer's phone matching a customer already, are the server's refusals, worded.
import { dec, formatMoney } from '@radcore/lib-common';
import { listParties, getParty } from '@radcore/lib-accounts/contract';
import { previewQuickBill } from '@radcore/lib-sales/contract';
import { useEffect, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { RadioField, TextField } from '../../../../components/ui/form/fields.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { issueWords } from '../issue-words.ts';
import { approvalIssues, holdChoiceState, quickBillSchema, type QuickBillInput, type Refusal } from './quick-bill-values.ts';
import { QUICK_BILL_MESSAGES } from './shared.ts';

/** A value that follows another after it has stood still for `ms`: a bill is previewed when the cashier pauses, not on each key. */
function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

/** The bill's figures from the server's preview (invoices:write, read only): the total, what the payments leave, and the checks that would
 * need an approval. `onFigures` tells the page the total shown, so a save can tell when the figures moved since the cashier looked. */
export function Preview({ onFigures }: { onFigures: (figures: { total: string; left: string; issues: readonly string[] } | null) => void }) {
  const { control } = useFormContext<QuickBillInput>();
  const values = useWatch({ control });
  // Only a bill that is complete enough to send is previewed; the same checks as the save, the contract's own.
  // (The figures don't need a card's approval code, which a save asks for and a hold leaves to the completion, so the bill is read as a hold;
  // the buyer is not part of the figures.)
  const parsed = useMemo(() => quickBillSchema.safeParse({ ...values, mode: 'hold', buyer: { name: '', phone: '', addressLine1: '', city: '', pincode: '' } }), [values]);
  const bill = parsed.success ? parsed.data.bill : null;
  const settled = useDebounced(bill === null ? null : JSON.stringify(bill), 600);
  const input = settled === null ? null : (JSON.parse(settled) as NonNullable<typeof bill>);
  const preview = useApiQuery(previewQuickBill, input as NonNullable<typeof bill>, { enabled: input !== null });
  const data = input === null ? undefined : preview.data;
  useEffect(() => { onFigures(data === undefined ? null : { total: data.total, left: data.left, issues: data.issues }); }, [data, onFigures]);
  if (input === null) return null;
  if (preview.error !== null) {
    const said = preview.error instanceof ApiError ? QUICK_BILL_MESSAGES[preview.error.code] ?? preview.error.message : t('sales.quick.preview.err');
    return <p role="alert" className="kit-form-alert">{said}</p>;
  }
  if (data === undefined) return <p aria-busy="true">{t('sales.quick.preview.loading')}</p>;
  return (
    <section aria-labelledby="quick-preview">
      <h2 id="quick-preview">{t('sales.quick.preview.title')}</h2>
      <dl className="admin-facts">
        <dt>{t('sales.quick.done.total')}</dt><dd>{formatMoney(data.total)}</dd>
        <dt>{t('sales.quick.done.paid')}</dt><dd>{formatMoney(data.paid)}</dd>
        <dt>{t('sales.quick.done.left')}</dt><dd>{formatMoney(data.left)}</dd>
      </dl>
      {approvalIssues(data.issues).length === 0 ? null : (
        <>
          <p>{t('sales.quick.preview.issues')}</p>
          <ul>{approvalIssues(data.issues).map((c) => <li key={c}>{issueWords(c)}</li>)}</ul>
        </>
      )}
      {data.issues.includes('walk_in_pays_in_full') ? <p>{issueWords('walk_in_pays_in_full')}</p> : null}
    </section>
  );
}

/** Save now, or hold for an approval and complete it later: drawn when holdChoiceState says (a check needs an approval, a save was refused
 * in a way a hold answers, or the Counter customer is left a balance by someone who may). A refusal makes hold the default; when the
 * choice is not drawn the mode goes back to "save". */
export function HoldChoice({ issues, refused, left }: { issues: number; refused: Refusal; left: string | null }) {
  const { control, setValue } = useFormContext<QuickBillInput>();
  const customer = useWatch({ control, name: 'customer' });
  const mayCredit = useMe().permissions.includes('sales:counter_credit');
  const { shown, holdByDefault } = holdChoiceState({ issues, refused, counter: customer === 'counter', mayCredit, leftOver: left !== null && dec(left).gt(0) });
  useEffect(() => {
    if (!shown) setValue('mode', 'save');
    else if (holdByDefault) setValue('mode', 'hold');
  }, [shown, holdByDefault, setValue]);
  if (!shown) return null;
  const balanceOnly = issues === 0 && refused === null;
  return (
    <RadioField name="mode" label={t('sales.quick.mode')} hint={t(balanceOnly ? 'sales.quick.mode.hint.balance' : 'sales.quick.mode.hint')} options={[
      { value: 'save', label: t('sales.quick.mode.save') }, { value: 'hold', label: t('sales.quick.mode.hold') },
    ]} />
  );
}

/** The customer a bill's buyer already is, by phone (parties:contact, which the lookup needs): offered in place of making them again. */
function PhoneMatch({ phone }: { phone: string }) {
  const { setValue } = useFormContext<QuickBillInput>();
  const may = useMe().permissions.includes('parties:contact');
  const found = useApiList(listParties, { filter: { phone } }, { enabled: may && phone.replaceAll(/\D/g, '').length >= 10 });
  const party = found.items[0];
  if (!may || party === undefined) return null;
  return (
    <p>
      {t('sales.quick.buyer.exists', { name: party.name })}{' '}
      <button type="button" className="kit-button"
        onClick={() => { setValue('customer', 'named'); setValue('partyId', party.id); }}>{t('sales.quick.buyer.use')}</button>
    </p>
  );
}

/** The walk-in who leaves a balance, on a hold (sales:counter_credit). Without a name and mobile the Counter customer pays in full. */
export function BuyerBox() {
  const { control } = useFormContext<QuickBillInput>();
  const mode = useWatch({ control, name: 'mode' });
  const customer = useWatch({ control, name: 'customer' });
  const phone = useWatch({ control, name: 'buyer.phone' });
  const may = useMe().permissions.includes('sales:counter_credit');
  if (mode !== 'hold' || customer !== 'counter' || !may) return null;
  return (
    <fieldset>
      <legend>{t('sales.quick.buyer')}</legend>
      <p className="kit-field-hint">{t('sales.quick.buyer.hint')}</p>
      <TextField name="buyer.name" label={t('sales.quick.buyer.name')} autoComplete="off" />
      <TextField name="buyer.phone" label={t('sales.quick.buyer.phone')} inputMode="tel" autoComplete="off" />
      <PhoneMatch phone={phone.trim()} />
      <TextField name="buyer.addressLine1" label={t('sales.quick.buyer.address')} autoComplete="off" />
      <TextField name="buyer.city" label={t('sales.quick.buyer.city')} autoComplete="off" />
      <TextField name="buyer.pincode" label={t('sales.quick.buyer.pincode')} inputMode="numeric" autoComplete="off" />
    </fieldset>
  );
}

/** The named customer already chosen (a buyer who exists), by name, so the picker shows them. */
export function usePartyName(partyId: string): { id: string; name: string } | null {
  const party = useApiQuery(getParty, { id: partyId }, { enabled: partyId !== '' }).data;
  return party === undefined ? null : { id: party.id, name: party.name };
}
