'use client';
// A new purchase order (RAD-143): a draft, which gets its number only when it's placed.
import { createPurchaseOrder, listPurchaseOrders } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { NEW_PO, PoForm } from '../po-form.tsx';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const create = useApiMutation(createPurchaseOrder, { invalidates: [listPurchaseOrders] });
  return (
    <>
      <p><Link href="/purchases/orders">{t('purchases.back')}</Link></p>
      <h1 id="new-po">{t('purchases.order.new.title')}</h1>
      <PoForm labelledBy="new-po" initial={NEW_PO} submit={t('purchases.order.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('purchases.order.saved')), 0);
          router.push(`/purchases/orders/${id}`);
        }} />
    </>
  );
}
