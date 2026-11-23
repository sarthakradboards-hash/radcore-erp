'use client';
// Editing a draft count (RAD-144): it's rewritten whole. A posted or cancelled count isn't edited.
import { getStockCount, listStockCounts, updateStockCount } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { asLocal, CountForm } from '../../count-form.tsx';

export default function EditStockCountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getStockCount, { id });
  const update = useApiMutation(updateStockCount, { invalidates: [getStockCount, listStockCounts] });
  const c = q.data;
  const back = <p><Link href={`/stock/counts/${id}`}>{t('stock.count.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('stock.count.missing')}</p></>;
  if (c === undefined) return <p>{t('loading')}</p>;
  if (c.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('stock.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-count">{t('stock.count.edit.title')}</h1>
      <CountForm labelledBy="edit-count" submit={t('stock.count.save')}
        initial={{ locationId: c.locationId, countedAt: asLocal(c.countedAt), businessDate: c.businessDate, reason: c.reason,
          lines: c.lines.map((l) => ({ itemId: l.itemId, batchId: l.batchId ?? '', qty: asWritten(l.found), serials: l.serials.join('\n') })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('stock.saved')), 0);
          router.push(`/stock/counts/${id}`);
        }} />
    </>
  );
}
