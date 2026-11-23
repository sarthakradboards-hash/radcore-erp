'use client';
// Changing a draft arrival (RAD-143): it is rewritten whole, keeping its purchase order. A posted receipt is never edited (it is cancelled).
import { getGoodsReceipt, listGoodsReceipts, updateGoodsReceipt } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMe } from '../../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { ArrivalForm } from '../../arrival-form.tsx';

export default function EditArrivalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('inward:write');
  const q = useApiQuery(getGoodsReceipt, { id });
  const update = useApiMutation(updateGoodsReceipt, { invalidates: [getGoodsReceipt, listGoodsReceipts] });
  const receipt = q.data;
  const back = <p><Link href={`/purchases/receipts/${id}`}>{t('inward.back')}</Link></p>;
  if (!mayWrite) return <>{back}<p role="alert" className="kit-form-alert">{t('inward.err.forbidden')}</p></>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('inward.missing')}</p></>;
  if (receipt === undefined) return <p>{t('loading')}</p>;
  if (receipt.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-arrival">{t('inward.form.edit.title')}</h1>
      <ArrivalForm labelledBy="edit-arrival" submit={t('inward.form.save')}
        initial={{ orderId: receipt.orderId, businessDate: receipt.businessDate, locationId: receipt.locationId, rejectsLocationId: receipt.rejectsLocationId,
          supplierRef: receipt.supplierRef ?? '', notes: receipt.notes ?? '',
          lines: receipt.lines.map((l) => ({ orderLineId: l.orderLineId, label: `${l.name} (${l.sku})`, info: '', received: asWritten(l.received) })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('inward.form.saved')), 0);
          router.push(`/purchases/receipts/${id}`);
        }} />
    </>
  );
}
