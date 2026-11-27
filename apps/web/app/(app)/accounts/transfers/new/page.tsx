'use client';
// Record a transfer (RAD-168 on RAD-165's #432, F19): from one of the company's money accounts into another, posted as it's
// saved. payments:write (which needs the second factor). The accounts come from /money-accounts (money_accounts:read).
import { recordTransferContract, listTransfersContract } from '@radcore/lib-accounts/contract';
import { useRouter } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { useMoneyAccounts } from '../../../sales/money-accounts.ts';
import { newTransfer, TRANSFER_MESSAGES, transferSchema } from '../transfer-values.ts';

export default function NewTransferPage() {
  const mayWrite = useMe().permissions.includes('payments:write');
  const accounts = useMoneyAccounts();
  const record = useApiMutation(recordTransferContract, { invalidates: [listTransfersContract] });
  const router = useRouter();
  const body = !mayWrite ? <p role="alert" className="kit-form-alert">{t('books.transfers.noWrite')}</p>
    : accounts === 'hidden' ? <p role="alert" className="kit-form-alert">{t('books.transfers.hidden')}</p>
    : accounts === null ? <p>{t('loading')}</p>
    : (
      <Form aria-labelledby="record-transfer" schema={transferSchema} saved={false} messages={TRANSFER_MESSAGES} defaultValues={newTransfer()}
        onSubmit={async (v) => {
          const done = await record.submit(v);
          setTimeout(() => announce(t('books.transfers.done', { number: done.number })), 0);
          router.push(`/accounts/transfers/${done.id}`);
        }}>
        <SelectField name="fromAccountId" label={t('books.transfers.from')} placeholder={t('books.transfers.pick')} options={accounts} />
        <SelectField name="toAccountId" label={t('books.transfers.to')} placeholder={t('books.transfers.pick')} options={accounts} />
        <TextField name="amount" label={t('books.transfers.amount')} hint={t('books.transfers.amount.hint')} inputMode="decimal" autoComplete="off" />
        <TextField name="businessDate" label={t('books.transfers.date')} type="date" />
        <TextField name="reference" label={t('books.transfers.reference')} hint={t('books.transfers.reference.hint')} autoComplete="off" />
        <TextAreaField name="notes" label={t('books.transfers.notes')} />
        <SubmitButton>{t('books.transfers.save')}</SubmitButton>
      </Form>
    );
  return (
    <>
      <h1 id="record-transfer">{t('books.transfers.form.title')}</h1>
      <p>{t('books.transfers.form.intro')}</p>
      {body}
    </>
  );
}
