'use client';
// Applying a receipt to the customer's open bills, or a payment to the supplier's (RAD-126 and RAD-143 on RAD-116's allocation route):
// a customer's open bills come from their statement (receivables:read), a supplier's from the purchase bills with something still to
// pay (purchasing:read), each with what is open on it, and the person says how much of the receipt or payment pays each. Within what is
// left of each bill and of the money, the date, and whether the bill is posted are the server's to say; the screen shows the amounts
// entered next to the money's own, and words the refusals. It can be left unapplied and applied later.
import { dec, formatDate, formatMoney, indiaDate, sum } from '@radcore/lib-common';
import { allocatePaymentContract, getPartyStatement, getPaymentContract, listPaymentsContract } from '@radcore/lib-accounts/contract';
import { listPurchaseBills } from '@radcore/lib-purchasing/contract';
import { useFormContext, useWatch } from 'react-hook-form';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PAYMENT_MESSAGES } from './payment-form.tsx';
import { allocateSchema, type AllocateInput } from './payment-values.ts';

type Props = { paymentId: string; partyId: string; amount: string; onDone: (n: number) => void };
/** A bill to apply to: its table and id for the route, and the words its box is labelled with. */
type Bill = { table: string; id: string; label: string };

// A payment out names a supplier's bills, so the shared wording about a receipt and a customer's bills doesn't fit these refusals.
const SUPPLIER_MESSAGES: Partial<Record<string, string>> = {
  ...PAYMENT_MESSAGES, party_mismatch: t('books.pay.err.pay.party_mismatch'), side_mismatch: t('books.pay.err.pay.side_mismatch'),
  document_not_posted: t('books.pay.err.pay.document_not_posted'), not_posted: t('books.pay.err.pay.not_posted'),
};

/** What the amounts entered add up to, beside the money's own amount. */
function Entered({ amount }: { amount: string }) {
  const { control } = useFormContext<AllocateInput>();
  const lines = useWatch({ control, name: 'lines' });
  const entered = sum(lines.map((l) => l.amount.trim()).filter((a) => /^\d+(\.\d{1,2})?$/.test(a)));
  return <p>{t('books.pay.allocate.entered', { entered: formatMoney(entered.toString()), amount: formatMoney(amount) })}</p>;
}

function Bills({ paymentId, amount, bills, messages, onDone }: Omit<Props, 'partyId'> & { bills: readonly Bill[]; messages: Partial<Record<string, string>> }) {
  const today = indiaDate(new Date());
  const allocate = useApiMutation(allocatePaymentContract, { invalidates: [getPaymentContract, listPaymentsContract] });
  if (bills.length === 0) return <p>{t('books.pay.allocate.none')}</p>;
  return (
    <Form schema={allocateSchema} saved={false} messages={messages}
      defaultValues={{ businessDate: today, lines: bills.map((b) => ({ documentTable: b.table, documentId: b.id, amount: '' })) }}
      onSubmit={async (v) => {
        const done = await allocate.submit({ id: paymentId, ...v });
        setTimeout(() => announce(t('books.pay.allocate.done', { n: String(done.ids.length) })), 0);
        onDone(done.ids.length);
      }}>
      <TextField name="businessDate" label={t('books.pay.allocate.date')} type="date" />
      {bills.map((b, i) => (
        <TextField key={`${b.table}:${b.id}`} name={`lines.${i}.amount`} inputMode="decimal" autoComplete="off" label={t('books.pay.allocate.amount', { bill: b.label })} />
      ))}
      <Entered amount={amount} />
      <SubmitButton>{t('books.pay.allocate.save')}</SubmitButton>
    </Form>
  );
}

function CustomerBills({ paymentId, partyId, amount, onDone }: Props) {
  const may = useMe().permissions.includes('receivables:read');
  const today = indiaDate(new Date());
  const statement = useApiQuery(getPartyStatement, { id: partyId, from: today, to: today }, { enabled: may });
  if (!may) return <p>{t('books.pay.allocate.hidden')}</p>;
  if (statement.error !== null) return <p role="alert" className="kit-form-alert">{t('books.pay.allocate.err.read')}</p>;
  if (statement.data === undefined) return <p>{t('loading')}</p>;
  const bills = statement.data.openBills.filter((b) => dec(b.open).gt(0)).map((b) => ({
    table: b.table, id: b.id,
    label: `${b.documentNumber ?? b.entryNumber} (${t('books.pay.allocate.due')} ${formatDate(b.due)}, ${t('books.pay.allocate.open')} ${formatMoney(b.open)})`,
  }));
  return <Bills paymentId={paymentId} amount={amount} bills={bills} messages={PAYMENT_MESSAGES} onDone={onDone} />;
}

// shortcut: the first 100 bills with something open are offered; more than that shows a note to apply to those and open this again.
const SUPPLIER_BILLS = 100;

function SupplierBills({ paymentId, partyId, amount, onDone }: Props) {
  const may = useMe().permissions.includes('purchasing:read');
  const list = useApiList(listPurchaseBills, { filter: { supplierId: partyId, open: true } }, { limit: SUPPLIER_BILLS, enabled: may });
  if (!may) return <p>{t('books.pay.allocate.hidden.pay')}</p>;
  if (list.error !== null) return <p role="alert" className="kit-form-alert">{t('books.pay.allocate.err.read.pay')}</p>;
  if (list.isPending) return <p>{t('loading')}</p>;
  const bills = list.items.filter((b) => b.open !== null && dec(b.open).gt(0)).map((b) => ({
    table: 'purchase_bills', id: b.id,
    label: `${b.number ?? ''} (${t('books.pay.allocate.theirs', { number: b.supplierInvoiceNumber, date: formatDate(b.supplierInvoiceDate) })}, ${t('books.pay.allocate.open')} ${formatMoney(b.open ?? '0')})`,
  }));
  return (
    <>
      {list.hasNextPage ? <p>{t('books.pay.allocate.more.pay', { n: String(SUPPLIER_BILLS) })}</p> : null}
      <Bills paymentId={paymentId} amount={amount} bills={bills} messages={SUPPLIER_MESSAGES} onDone={onDone} />
    </>
  );
}

/** The form: a receipt goes to the customer's bills, a payment to the supplier's. */
export function AllocateForm(props: Props & { kind: 'receipt' | 'payment' }) {
  return props.kind === 'payment' ? <SupplierBills {...props} /> : <CustomerBills {...props} />;
}
