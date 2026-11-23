'use client';
// Editing a draft adjustment (RAD-144): it's rewritten whole. A posted or cancelled adjustment isn't edited.
import { getStockAdjustment, listStockAdjustments, updateStockAdjustment } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { batchKey } from '../../../../sales/deliveries/stock-pick.tsx';
import { AdjustmentForm } from '../../adjustment-form.tsx';

export default function EditStockAdjustmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getStockAdjustment, { id });
  const update = useApiMutation(updateStockAdjustment, { invalidates: [getStockAdjustment, listStockAdjustments] });
  const a = q.data;
  const back = <p><Link href={`/stock/adjustments/${id}`}>{t('stock.adjustment.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('stock.adjustment.missing')}</p></>;
  if (a === undefined) return <p>{t('loading')}</p>;
  if (a.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('stock.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-adjustment">{t('stock.adjustment.edit.title')}</h1>
      <AdjustmentForm labelledBy="edit-adjustment" submit={t('stock.adjustment.save')}
        initial={{ locationId: a.locationId, businessDate: a.businessDate, reason: a.reason,
          lines: a.lines.map((l) => ({ itemId: l.itemId, direction: l.direction, qty: asWritten(l.qty),
            pick: Object.fromEntries(l.batches.map((b) => [batchKey(b.batchId), asWritten(b.qty)])),
            serials: l.direction === 'out' ? l.serials.map((s) => s.serialNo) : [],
            unitsText: l.direction === 'in' ? l.serials.map((s) => (s.chassisNo === null ? s.serialNo : `${s.serialNo}, ${s.chassisNo}`)).join('\n') : '',
            condition: l.condition ?? '' })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('stock.saved')), 0);
          router.push(`/stock/adjustments/${id}`);
        }} />
    </>
  );
}
