'use client';
// A new delivery (RAD-125): a draft against a confirmed order, which gets its number only when it's posted.
import { createDelivery, listDeliveries } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { DeliveryForm } from '../delivery-form.tsx';
import { NEW_DELIVERY } from '../delivery-values.ts';

export default function NewDeliveryPage() {
  const router = useRouter();
  const create = useApiMutation(createDelivery, { invalidates: [listDeliveries] });
  return (
    <>
      <p><Link href="/sales/deliveries">{t('sales.back')}</Link></p>
      <h1 id="new-delivery">{t('sales.delivery.new.title')}</h1>
      <DeliveryForm labelledBy="new-delivery" initial={NEW_DELIVERY} submit={t('sales.delivery.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('sales.delivery.saved')), 0);
          router.push(`/sales/deliveries/${id}`);
        }} />
    </>
  );
}
