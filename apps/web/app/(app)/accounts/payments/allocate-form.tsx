'use client';
// Applying a receipt to the customer's open bills (RAD-126 on RAD-116's allocation route): the customer's open bills come from their
// statement (receivables:read), each with what is open on it, and the person says how much of the receipt pays each. Within what is left
// of each bill and of the receipt, the date, and whether the bill is posted are the server's to say; the screen shows the amounts
// entered next to the receipt's, and words the refusals. A receipt can be left unapplied and applied later.
import { dec, formatDate, formatMoney, indiaDate, sum } from '@radcore/lib-common';
import { allocatePaymentContract, getPartyStatement } from '@radcore/lib-accounts/contract';
import { useFormContext, useWatch } from 'react-hook-form';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PAYMENT_MESSAGES } from './payment-form.tsx';
import { allocateSchema, type AllocateInput } from './payment-values.ts';

/** What the amounts entered add up to, beside the receipt's amount. */
function Entered({ amount }: { amount: string }) {
  const { control } = useFormContext<AllocateInput>();
  const lines = useWatch({ control, name: 'lines' });
  const entered = sum(lines.map((l) => l.amount.trim()).filter((a) => /^\d+(\.\d{1,2})?$/.test(a)));
  return <p>{t('books.pay.allocate.entered', { entered: formatMoney(entered.toString()), amount: formatMoney(amount) })}</p>;
}

export function AllocateForm({ paymentId, partyId, amount, onDone }: { paymentId: string; partyId: string; amount: string; onDone: (n: number) => void }) {
  const may = useMe().permissions.includes('receivables:read');
  const today = indiaDate(new Date());
  const statement = useApiQuery(getPartyStatement, { id: partyId, from: today, to: today }, { enabled: may });
  const allocate = useApiMutation(allocatePaymentContract);
  if (!may) return <p>{t('books.pay.allocate.hidden')}</p>;
  if (statement.data === undefined) return <p>{statement.error === null ? t('loading') : t('books.pay.allocate.none')}</p>;
  const bills = statement.data.openBills.filter((b) => dec(b.open).gt(0));
  if (bills.length === 0) return <p>{t('books.pay.allocate.none')}</p>;
  return (
    <Form schema={allocateSchema} saved={false} messages={PAYMENT_MESSAGES}
      defaultValues={{ businessDate: today, lines: bills.map((b) => ({ documentTable: b.table, documentId: b.id, amount: '' })) }}
      onSubmit={async (v) => {
        const done = await allocate.submit({ id: paymentId, ...v });
        setTimeout(() => announce(t('books.pay.allocate.done', { n: String(done.ids.length) })), 0);
        onDone(done.ids.length);
      }}>
      <TextField name="businessDate" label={t('books.pay.allocate.date')} type="date" />
      {bills.map((b, i) => (
        <TextField key={`${b.table}:${b.id}`} name={`lines.${i}.amount`} inputMode="decimal" autoComplete="off"
          label={t('books.pay.allocate.amount', { bill: `${b.documentNumber ?? b.entryNumber} (${t('books.pay.allocate.due')} ${formatDate(b.due)}, ${t('books.pay.allocate.open')} ${formatMoney(b.open)})` })} />
      ))}
      <Entered amount={amount} />
      <SubmitButton>{t('books.pay.allocate.save')}</SubmitButton>
    </Form>
  );
}
