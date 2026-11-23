'use client';
// What can be done to a payment (RAD-126 on RAD-116's routes, payments:write, which needs the second factor): cancel it (a mirror
// entry on a date, with a reason; refused while it is applied or refunded), refund a receipt (money back to the customer against it,
// within what is left), and undo one application to a bill. Whether each is allowed, the period, and the amounts are the server's to
// say; the screen words the refusals.
import { dateString, indiaDate } from '@radcore/lib-common';
import {
  cancelPaymentContract, getPaymentContract, listPaymentsContract, recordPaymentContract, reverseAllocationContract,
} from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { useMoneyAccounts } from '../../../sales/money-accounts.ts';
import { PAYMENT_MESSAGES } from '../payment-form.tsx';
import { refundSchema } from '../payment-values.ts';

const later = (text: string) => setTimeout(() => announce(text), 0);
const refresh = [getPaymentContract, listPaymentsContract] as const;
const dateAndReason = (reason: z.ZodType<string>) => z.object({ businessDate: dateString(), reason });

export function CancelPayment({ id, onClose }: { id: string; onClose: () => void }) {
  const cancel = useApiMutation(cancelPaymentContract, { invalidates: refresh });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('books.pay.cancel.title')} description={t('books.pay.cancel.body')}>
      <Form schema={dateAndReason(cancelPaymentContract.input.shape.reason)} saved={false} messages={PAYMENT_MESSAGES}
        defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
        onSubmit={async (v) => { await cancel.submit({ id, ...v }); onClose(); later(t('books.pay.cancelled')); }}>
        <TextField name="businessDate" label={t('books.pay.cancel.date')} type="date" />
        <TextAreaField name="reason" label={t('books.pay.cancel.reason')} />
        <div className="kit-actions">
          <CloseButton>{t('books.pay.close')}</CloseButton>
          <SubmitButton>{t('books.pay.cancel')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export function ReverseApplication({ allocationId, onClose }: { allocationId: string; onClose: () => void }) {
  const reverse = useApiMutation(reverseAllocationContract, { invalidates: refresh });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('books.pay.alloc.reverse.title')} description={t('books.pay.alloc.reverse.body')}>
      <Form schema={dateAndReason(reverseAllocationContract.input.shape.reason)} saved={false} messages={PAYMENT_MESSAGES}
        defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
        onSubmit={async (v) => { await reverse.submit({ id: allocationId, ...v }); onClose(); later(t('books.pay.alloc.reversed')); }}>
        <TextField name="businessDate" label={t('books.pay.alloc.reverse.date')} type="date" />
        <TextAreaField name="reason" label={t('books.pay.cancel.reason')} />
        <div className="kit-actions">
          <CloseButton>{t('books.pay.close')}</CloseButton>
          <SubmitButton>{t('books.pay.alloc.reverse.save')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export function RefundReceipt({ receipt, onClose }: { receipt: { id: string; number: string; partyId: string }; onClose: () => void }) {
  const record = useApiMutation(recordPaymentContract, { invalidates: refresh });
  const accounts = useMoneyAccounts();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('books.pay.refund.title', { number: receipt.number })} description={t('books.pay.refund.body')}>
      {accounts === 'hidden' ? <p>{t('books.pay.account.hidden')}</p> : (
        <Form schema={refundSchema} saved={false} messages={PAYMENT_MESSAGES}
          defaultValues={{ businessDate: indiaDate(new Date()), amount: '', accountId: '', reference: '' }}
          onSubmit={async (v) => {
            const done = await record.submit({ kind: 'refund', partyId: receipt.partyId, refundOf: receipt.id, ...v });
            onClose();
            later(done.status === 'posted' ? t('books.pay.refund.done') : t('books.pay.refund.waiting'));
          }}>
          <TextField name="businessDate" label={t('books.pay.date')} type="date" />
          <TextField name="amount" label={t('books.pay.amount')} inputMode="decimal" autoComplete="off" />
          <SelectField name="accountId" label={t('books.pay.account')} placeholder={t('books.pay.account.none')} options={accounts ?? []} />
          <TextField name="reference" label={t('books.pay.reference')} hint={t('books.pay.reference.hint')} autoComplete="off" />
          <div className="kit-actions">
            <CloseButton>{t('books.pay.close')}</CloseButton>
            <SubmitButton>{t('books.pay.refund.save')}</SubmitButton>
          </div>
        </Form>
      )}
    </Dialog>
  );
}
