'use client';
// A new delivery return (RAD-125): a draft taking goods back from a posted delivery, which gets its number only when it's posted.
import { createDeliveryReturn, listDeliveryReturns } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ReturnForm } from '../return-form.tsx';
import { NEW_RETURN } from '../return-values.ts';

export default function NewDeliveryReturnPage() {
  const router = useRouter();
  const create = useApiMutation(createDeliveryReturn, { invalidates: [listDeliveryReturns] });
  return (
    <>
      <p><Link href="/sales/delivery-returns">{t('sales.back')}</Link></p>
      <h1 id="new-return">{t('sales.return.new.title')}</h1>
      <ReturnForm labelledBy="new-return" initial={NEW_RETURN} submit={t('sales.return.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('sales.return.saved')), 0);
          router.push(`/sales/delivery-returns/${id}`);
        }} />
    </>
  );
}
