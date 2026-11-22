'use client';
// A new test ride (RAD-127): a lead, a demo unit and a time.
import { listTestRides, scheduleTestRide } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { RideForm } from '../ride-form.tsx';
import { NEW_RIDE } from '../ride-values.ts';

export default function NewTestRidePage() {
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('bookings:write');
  const schedule = useApiMutation(scheduleTestRide, { invalidates: [listTestRides] });
  if (!mayWrite) return <><p><Link href="/sales/test-rides">{t('sales.back')}</Link></p><p role="alert" className="kit-form-alert">{t('sales.ride.err.forbidden')}</p></>;
  return (
    <>
      <p><Link href="/sales/test-rides">{t('sales.back')}</Link></p>
      <h1 id="new-ride">{t('sales.ride.new.title')}</h1>
      <RideForm labelledBy="new-ride" initial={NEW_RIDE} submit={t('sales.ride.form.save')}
        onSubmit={async (v) => {
          await schedule.submit(v);
          setTimeout(() => announce(t('sales.ride.saved')), 0);
          router.push('/sales/test-rides');
        }} />
    </>
  );
}
