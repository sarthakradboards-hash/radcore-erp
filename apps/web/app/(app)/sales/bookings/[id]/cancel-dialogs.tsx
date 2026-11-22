'use client';
// Cancelling a booking, and paying back what is still held after it is cancelled (RAD-127 on RAD-117's contracts). Cancelling
// takes a reason and a date; what is left of the advance (the server reads it live) can be paid back all at once, under
// bookings:refund_full, or in part, under bookings:refund_part, each behind its own key, so only the choices the person
// holds are shown. With neither key, or without the accounts to pay from, the booking is cancelled with no refund and the
// advance stays as the customer's credit. Keeping or forfeiting it is not a choice here (CA-47 is open). A cash refund past
// the day's limit waits for an owner; the cancellation is done either way. The keys, the second factor and the amounts are
// the server's to check.
import { dateString, dec, formatMoney, indiaDate, moneyString } from '@radcore/lib-common';
import { cancelBooking, getBooking, listBookings, refundBooking } from '@radcore/lib-sales/contract';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { RadioField, SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { useMoneyAccounts } from '../../money-accounts.ts';
import { BOOKING_MESSAGES } from '../shared.ts';
import { type Choice, refundFor } from './refund-choice.ts';

const later = (text: string) => setTimeout(() => announce(text), 0);

/** The refund choices this person may make, from the keys they hold; empty when nothing is left to pay back or the accounts can't
 * be read. */
function useRefundChoices(left: string, accounts: ReturnType<typeof useMoneyAccounts>): Exclude<Choice, 'none'>[] {
  const { permissions } = useMe();
  if (accounts === 'hidden' || !dec(left).gt(0)) return [];
  return [...(permissions.includes('bookings:refund_full') ? ['full' as const] : []), ...(permissions.includes('bookings:refund_part') ? ['part' as const] : [])];
}

const refundFields = {
  choice: z.enum(['full', 'part', 'none']),
  amount: z.string().trim(),
  accountId: z.string(),
};
/** What a refund needs: for a part, an amount; for any refund, an account. (The server checks the amount against what is left.) */
const needsRefundParts = (v: { choice: Choice; amount: string; accountId: string }, ctx: z.RefinementCtx) => {
  if (v.choice === 'none') return;
  if (v.choice === 'part' && !moneyString().safeParse(v.amount).success) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: t('sales.booking.refund.err.amount') });
  }
  if (v.accountId === '') ctx.addIssue({ code: 'custom', path: ['accountId'], message: t('sales.booking.refund.err.account') });
};

/** The refund's own fields: the choice (when there is one to make), the amount for a part, and the account to pay from. */
function RefundFields({ choices, accounts, withNone }: {
  choices: readonly Exclude<Choice, 'none'>[]; accounts: ReturnType<typeof useMoneyAccounts>;
  /** Cancelling may pay back nothing now (the advance stays as credit); paying back what is held after it may not. */
  withNone: boolean;
}) {
  const { control } = useFormContext<{ choice: Choice }>();
  const choice = useWatch({ control, name: 'choice' });
  if (choices.length === 0) return <p>{accounts === 'hidden' ? t('sales.booking.refund.hidden') : t('sales.booking.cancel.nothing')}</p>;
  return (
    <>
      <RadioField name="choice" label={t('sales.booking.refund.choice')}
        options={[...(withNone ? ['none' as const] : []), ...choices].map((c) => ({ value: c, label: t(`sales.booking.refund.${c}`) }))} />
      {choice === 'part' ? <TextField name="amount" label={t('sales.booking.refund.amount')} inputMode="decimal" autoComplete="off" /> : null}
      {choice === 'none' ? null : (
        <SelectField name="accountId" label={t('sales.booking.refund.account')} placeholder={t('sales.booking.refund.account.none')} options={accounts === 'hidden' ? [] : accounts ?? []} />
      )}
    </>
  );
}

const cancelShape = cancelBooking.input.shape;
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelShape.reason, ...refundFields }).superRefine(needsRefundParts);

/** The dialog that cancels a booked booking. `left` is what the server says is left of the advance. */
export function CancelBooking({ id, number, left, open, onOpenChange }: {
  id: string; number: string; left: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const accounts = useMoneyAccounts();
  const choices = useRefundChoices(left, accounts);
  const cancel = useApiMutation(cancelBooking, { invalidates: [getBooking, listBookings] });
  // A key holder's default is to pay nothing back now: no money moves unless they choose it.
  const first: Choice = 'none';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('sales.booking.cancel.title', { number })} description={t('sales.booking.cancel.body')}>
      <Form schema={cancelSchema} saved={false} messages={BOOKING_MESSAGES}
        defaultValues={{ businessDate: indiaDate(new Date()), reason: '', choice: first, amount: '', accountId: '' }}
        onSubmit={async (v) => {
          const refund = refundFor(v.choice, left, v.amount, v.accountId);
          const done = await cancel.submit({ id, businessDate: v.businessDate, reason: v.reason, ...(refund === undefined ? {} : { refund }) });
          onOpenChange(false);
          later([t('sales.booking.cancelled'),
            ...done.refunds.map((r) => (r.status === 'posted' && r.number !== null ? t('sales.booking.cancelled.refunded', { number: r.number }) : t('sales.booking.cancelled.waiting'))),
            ...(dec(done.credit).gt(0) ? [t('sales.booking.cancelled.credit', { amount: formatMoney(done.credit) })] : [])].join(' '));
        }}>
        <TextField name="businessDate" label={t('sales.booking.cancel.date')} type="date" />
        <TextAreaField name="reason" label={t('sales.booking.cancel.reason')} />
        <p>{dec(left).gt(0) ? t('sales.booking.cancel.left', { amount: formatMoney(left) }) : t('sales.booking.cancel.none.left')}</p>
        <RefundFields choices={choices} accounts={accounts} withNone />
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          <SubmitButton>{t('sales.booking.cancel')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

const laterSchema = z.object({ businessDate: dateString(), ...refundFields }).superRefine(needsRefundParts);

/** The dialog that pays back what is still held for a cancelled booking. */
export function RefundHeld({ id, left, open, onOpenChange }: { id: string; left: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const accounts = useMoneyAccounts();
  const choices = useRefundChoices(left, accounts);
  const refund = useApiMutation(refundBooking, { invalidates: [getBooking, listBookings] });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('sales.booking.refund.later.title')} description={t('sales.booking.refund.later.body')}>
      <Form schema={laterSchema} saved={false} messages={BOOKING_MESSAGES}
        defaultValues={{ businessDate: indiaDate(new Date()), choice: choices[0] ?? 'full', amount: '', accountId: '' }}
        onSubmit={async (v) => {
          const paid = refundFor(v.choice, left, v.amount, v.accountId);
          if (paid === undefined) return;
          const done = await refund.submit({ id, ...paid, businessDate: v.businessDate });
          onOpenChange(false);
          later(done.refunds.map((r) => (r.status === 'posted' && r.number !== null ? t('sales.booking.cancelled.refunded', { number: r.number }) : t('sales.booking.cancelled.waiting'))).join(' '));
        }}>
        <TextField name="businessDate" label={t('sales.booking.refund.later.date')} type="date" />
        <p>{t('sales.booking.cancel.left', { amount: formatMoney(left) })}</p>
        <RefundFields choices={choices} accounts={accounts} withNone={false} />
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          {choices.length === 0 ? null : <SubmitButton>{t('sales.booking.refund.later')}</SubmitButton>}
        </div>
      </Form>
    </Dialog>
  );
}
