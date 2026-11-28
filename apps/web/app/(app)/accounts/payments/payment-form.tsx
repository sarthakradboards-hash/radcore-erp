'use client';
// The form a payment is recorded in (RAD-126 on RAD-116's contract): a receipt from a customer or a payment to a supplier, its party,
// date, amount, its TDS (a payment's from the section picked, under tds:read), the money account (from /money-accounts, money_accounts:read), and the reference, which is never card
// digits. Whether the date, the period and the account are allowed, whether cash is past the day's limit (it then waits for an owner)
// and the second factor are the server's to judge; the screen words what comes back. Nothing is computed here.
import { listParties, listTdsSections } from '@radcore/lib-accounts/contract';
import { useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { RadioField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { useMoneyAccounts } from '../../sales/money-accounts.ts';
import { JOURNAL_MESSAGES } from '../shared.tsx';
import { PAYMENT_KINDS, paymentSchema, sectionLabel, type PaymentInput, type PaymentValues } from './payment-values.ts';

const OWN = ['invalid_tds', 'exceeds_receipt', 'refund_through_owner', 'not_money_account', 'account_inactive', 'series_full', 'looks_like_card_number',
  'exceeds_payment', 'exceeds_document', 'party_mismatch', 'side_mismatch', 'document_not_posted', 'document_missing', 'not_allocatable', 'not_posted',
  'date_before_source', 'forbidden', 'has_refunds', 'has_allocations', 'refund_needs_receipt', 'receipt_not_posted', 'refund_other_party', 'not_draft',
  'already_reversed', 'amount_not_positive',
  // A payment's TDS (RAD-158). tds_mismatch is left to the server's words, which give the figure it works out.
  'tds_overseas', 'no_tds_rate', 'tds_payee_mismatch', 'unknown_section', 'tds_deposited'] as const;
export const PAYMENT_MESSAGES: Partial<Record<string, string>> = {
  ...JOURNAL_MESSAGES, ...Object.fromEntries(OWN.map((c) => [c, t(`books.pay.err.${c}`)])),
};

// A receipt is from a customer (or a dealer or franchisee we sell to), a payment to a supplier.
const useCustomers = (query: string) => useApiSearch(listParties, query, { params: { filter: { sellsTo: true, active: true } } });
const useSuppliers = (query: string) => useApiSearch(listParties, query, { params: { filter: { buysFrom: true, active: true } } });

/** The party's box: customers for a receipt, suppliers for a payment. Changing what it is empties the party, who may not fit. */
function PartyBox() {
  const { control, setValue } = useFormContext<PaymentInput>();
  const kind = useWatch({ control, name: 'kind' });
  const seen = useRef(kind);
  useEffect(() => {
    if (seen.current !== kind) {
      setValue('partyId', '');
      // A receipt's TDS and a payment's mean different things, so neither carries over.
      setValue('tds', '');
      setValue('tdsSectionId', '');
    }
    seen.current = kind;
  }, [kind, setValue]);
  // Keyed by kind: the picker keeps what was typed and picked, so each kind gets its own.
  return kind === 'receipt'
    ? <PickedField key="receipt" name="partyId" label={t('books.pay.party.receipt')} hint={t('books.pay.party.hint')} initial={null} useSearch={useCustomers} optionLabel={(p) => p.name} />
    : <PickedField key="payment" name="partyId" label={t('books.pay.party.payment')} hint={t('books.pay.party.hint')} initial={null} useSearch={useSuppliers} optionLabel={(p) => p.name} />;
}

/** A receipt's TDS is what the customer held back, as typed. A payment's is worked out by the server from its section when
 * it posts (RAD-158), so a figure typed beside the section only checks it. The sections need tds:read. */
function TdsFields() {
  const { control } = useFormContext<PaymentInput>();
  const kind = useWatch({ control, name: 'kind' });
  const section = useWatch({ control, name: 'tdsSectionId' });
  const mayRead = useMe().permissions.includes('tds:read');
  const sections = useApiQuery(listTdsSections, {}, { enabled: mayRead && kind === 'payment' });
  if (kind === 'receipt') return <TextField name="tds" label={t('books.pay.tds')} inputMode="decimal" autoComplete="off" />;
  if (!mayRead) return <p>{t('books.pay.tdsSection.hidden')}</p>;
  if (sections.error !== null) {
    return (
      <div role="alert" className="kit-form-alert">
        {t('books.pay.tdsSection.failed')} <button type="button" className="kit-button" onClick={() => void sections.refetch()}>{t('error.retry')}</button>
      </div>
    );
  }
  if (sections.data === undefined) return <p>{t('loading')}</p>;
  return (
    <>
      <SelectField name="tdsSectionId" label={t('books.pay.tdsSection')} hint={t('books.pay.tdsSection.hint')} placeholder={t('books.pay.tdsSection.none')}
        options={sections.data.items.map((s) => ({ value: s.id, label: sectionLabel(s) }))} />
      {section === '' ? null
        : <TextField name="tds" label={t('books.pay.tds.expected')} hint={t('books.pay.tds.expected.hint')} inputMode="decimal" autoComplete="off" />}
    </>
  );
}

export function PaymentForm({ labelledBy, initial, onSubmit }: { labelledBy: string; initial: PaymentInput; onSubmit: (values: PaymentValues) => Promise<unknown> }) {
  const accounts = useMoneyAccounts();
  if (accounts === 'hidden') return <p role="alert" className="kit-form-alert">{t('books.pay.account.hidden')}</p>;
  return (
    <Form aria-labelledby={labelledBy} schema={paymentSchema} saved={false} messages={PAYMENT_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <RadioField name="kind" label={t('books.pay.kind')} options={PAYMENT_KINDS.map((k) => ({ value: k, label: t(`books.pay.kind.${k}`) }))} />
      <PartyBox />
      <TextField name="businessDate" label={t('books.pay.date')} type="date" />
      <TextField name="amount" label={t('books.pay.amount')} hint={t('books.pay.amount.hint')} inputMode="decimal" autoComplete="off" />
      <TdsFields />
      <SelectField name="accountId" label={t('books.pay.account')} placeholder={t('books.pay.account.none')} options={accounts ?? []} />
      <TextField name="reference" label={t('books.pay.reference')} hint={t('books.pay.reference.hint')} autoComplete="off" />
      <TextAreaField name="narration" label={t('books.pay.narration')} />
      <SubmitButton>{t('books.pay.save')}</SubmitButton>
    </Form>
  );
}
