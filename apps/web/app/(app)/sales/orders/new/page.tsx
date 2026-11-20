'use client';
// A new order (RAD-125): a draft, which gets its number only when it's confirmed.
import { createOrder, listOrders } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { DocumentForm, NEW_DOCUMENT } from '../../document-form.tsx';

export default function NewOrderPage() {
  const router = useRouter();
  const create = useApiMutation(createOrder, { invalidates: [listOrders] });
  return (
    <>
      <p><Link href="/sales/orders">{t('sales.back')}</Link></p>
      <h1 id="new-order">{t('sales.order.new.title')}</h1>
      <DocumentForm labelledBy="new-order" initial={NEW_DOCUMENT} quote={false} submit={t('sales.order.save')}
        onSubmit={async ({ partyId, businessDate, notes, lines }) => {
          const { id } = await create.submit({ partyId, businessDate, notes, lines });
          setTimeout(() => announce(t('sales.order.saved')), 0);
          router.push(`/sales/orders/${id}`);
        }} />
    </>
  );
}
