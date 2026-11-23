'use client';
// A new stock adjustment (RAD-144): a draft, which posts only when someone else approves it.
import { createStockAdjustment, listStockAdjustments } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { AdjustmentForm, newAdjustment } from '../adjustment-form.tsx';

export default function NewStockAdjustmentPage() {
  const router = useRouter();
  const create = useApiMutation(createStockAdjustment, { invalidates: [listStockAdjustments] });
  const [initial] = useState(newAdjustment);
  return (
    <>
      <p><Link href="/stock/adjustments">{t('stock.adjustment.back')}</Link></p>
      <h1 id="new-adjustment">{t('stock.adjustment.new.title')}</h1>
      <AdjustmentForm labelledBy="new-adjustment" initial={initial} submit={t('stock.adjustment.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('stock.saved')), 0);
          router.push(`/stock/adjustments/${id}`);
        }} />
    </>
  );
}
