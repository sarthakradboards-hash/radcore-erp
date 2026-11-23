'use client';
// One vehicle booking (RAD-127 on RAD-117's contracts), in the record layout: where it is (the status bar), the order it is for
// (a related-record button), the advance (count cards), and its facts. A booked unit stays held for the customer until it is
// delivered or the booking is cancelled; another advance can be taken while it is booked. The advance is read live by the server
// (what was taken, and what is left of it), so nothing is worked out here.
import { dateString, dec, formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { addBookingAdvance, getBooking, listBookings } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { useMoneyAccounts } from '../../money-accounts.ts';
import { CancelBooking, RefundHeld } from './cancel-dialogs.tsx';
import { Checklist } from './checklist.tsx';
import { bookingSteps } from '../../status.ts';
import { BOOKING_MESSAGES } from '../shared.ts';

const later = (text: string) => setTimeout(() => announce(text), 0);
const shape = addBookingAdvance.input.shape;
const advanceSchema = z.object({
  amount: shape.amount, accountId: z.string().min(1, t('sales.booking.advance.account.none')).pipe(shape.accountId), businessDate: dateString(),
});

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('bookings:write');
  const mayRefund = permissions.includes('bookings:refund_full') || permissions.includes('bookings:refund_part');
  const q = useApiQuery(getBooking, { id });
  const add = useApiMutation(addBookingAdvance, { invalidates: [getBooking, listBookings] });
  const accounts = useMoneyAccounts();
  const [dialog, setDialog] = useState<'advance' | 'cancel' | 'refund' | null>(null);
  const booking = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/bookings">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (booking === undefined) return <p>{t('loading')}</p>;

  return (
    <>
      <p><Link href="/sales/bookings">{t('sales.back')}</Link></p>
      <h1>{t('sales.booking.title', { number: booking.number ?? '' })}</h1>
      <StatusBar label={t('sales.status.step')} steps={bookingSteps(booking.status)} current={booking.status} />
      <RelatedRecords label={t('sales.related')} links={[{ label: t('sales.booking.order'), href: `/sales/orders/${booking.orderId}` }]} />
      <CountCards label={t('sales.counts')} cards={[
        { label: t('sales.booking.count.taken'), value: formatMoney(booking.advance.taken) },
        { label: t('sales.booking.count.left'), value: formatMoney(booking.advance.left) },
      ]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{booking.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(booking.businessDate)}</dd>
        <dt>{t('sales.booking.unit')}</dt><dd>{booking.serialNo} ({booking.name}, {booking.sku})</dd>
        {booking.cancelReason === null ? null : <><dt>{t('sales.booking.cancelReason')}</dt><dd>{booking.cancelReason}</dd></>}
      </dl>
      {booking.status === 'booked' ? <p>{t('sales.booking.held')}</p> : null}
      {booking.unitCondition === 'damaged' ? <p>{t('sales.booking.damaged')}</p> : null}
      <div className="kit-actions">
        {mayWrite && booking.status === 'booked' ? (
          accounts === 'hidden' ? <p>{t('sales.booking.advance.account.hidden')}</p> : (
            <button type="button" className="kit-button" onClick={() => setDialog('advance')}>{t('sales.booking.advance.add')}</button>
          )
        ) : null}
        {mayWrite && booking.status === 'booked' ? (
          <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('sales.booking.cancel')}</button>
        ) : null}
        {mayWrite && mayRefund && booking.status === 'cancelled' && dec(booking.advance.left).gt(0) ? (
          <button type="button" className="kit-button" onClick={() => setDialog('refund')}>{t('sales.booking.refund.later')}</button>
        ) : null}
      </div>
      {booking.status === 'delivered' ? <Checklist id={id} checklist={booking.checklist} mayWrite={mayWrite} /> : null}

      <CancelBooking id={id} number={booking.number ?? ''} left={booking.advance.left} open={dialog === 'cancel'} onOpenChange={(open) => setDialog(open ? 'cancel' : null)} />
      <RefundHeld id={id} left={booking.advance.left} open={dialog === 'refund'} onOpenChange={(open) => setDialog(open ? 'refund' : null)} />

      <Dialog open={dialog === 'advance'} onOpenChange={(open) => setDialog(open ? 'advance' : null)} title={t('sales.booking.advance.title')} description={t('sales.booking.advance.body')}>
        {accounts === 'hidden' ? null : (
          <Form schema={advanceSchema} saved={false} messages={BOOKING_MESSAGES} defaultValues={{ amount: '', accountId: '', businessDate: indiaDate(new Date()) }}
            onSubmit={async (v) => {
              const receipt = await add.submit({ id, ...v });
              setDialog(null);
              later(receipt.status === 'posted' && receipt.number !== null
                ? t('sales.booking.advance.taken', { number: receipt.number }) : t('sales.booking.advance.waiting'));
            }}>
            <TextField name="amount" label={t('sales.booking.advance.amount')} inputMode="decimal" autoComplete="off" />
            <SelectField name="accountId" label={t('sales.booking.advance.account')} placeholder={t('sales.booking.advance.account.none')} options={accounts ?? []} />
            <TextField name="businessDate" label={t('sales.booking.advance.date')} type="date" />
            <div className="kit-actions">
              <CloseButton>{t('sales.cancel')}</CloseButton>
              <SubmitButton>{t('sales.booking.advance.add')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
