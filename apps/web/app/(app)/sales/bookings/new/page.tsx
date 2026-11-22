'use client';
// A new vehicle booking (RAD-127): a unit held for a customer's order line, with its advance.
import { createBooking, listBookings } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { BookingForm } from '../booking-form.tsx';
import { NEW_BOOKING } from '../booking-values.ts';

export default function NewBookingPage() {
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('bookings:write');
  const create = useApiMutation(createBooking, { invalidates: [listBookings] });
  if (!mayWrite) return <><p><Link href="/sales/bookings">{t('sales.back')}</Link></p><p role="alert" className="kit-form-alert">{t('sales.booking.err.forbidden')}</p></>;
  return (
    <>
      <p><Link href="/sales/bookings">{t('sales.back')}</Link></p>
      <h1 id="new-booking">{t('sales.booking.new.title')}</h1>
      <BookingForm labelledBy="new-booking" initial={NEW_BOOKING} submit={t('sales.booking.form.save')}
        onSubmit={async (v) => {
          const { id, number, receipt } = await create.submit(v);
          setTimeout(() => announce(receipt.status === 'posted' ? t('sales.booking.new.saved', { number }) : t('sales.booking.new.saved.waiting', { number })), 0);
          router.push(`/sales/bookings/${id}`);
        }} />
    </>
  );
}
