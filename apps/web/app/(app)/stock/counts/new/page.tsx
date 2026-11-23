'use client';
// A new stock count (RAD-144): a draft, which posts only when someone else approves it.
import { createStockCount, listStockCounts } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { CountForm, newCount } from '../count-form.tsx';

export default function NewStockCountPage() {
  const router = useRouter();
  const create = useApiMutation(createStockCount, { invalidates: [listStockCounts] });
  const [initial] = useState(newCount);
  return (
    <>
      <p><Link href="/stock/counts">{t('stock.count.back')}</Link></p>
      <h1 id="new-count">{t('stock.count.new.title')}</h1>
      <CountForm labelledBy="new-count" initial={initial} submit={t('stock.count.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('stock.saved')), 0);
          router.push(`/stock/counts/${id}`);
        }} />
    </>
  );
}
