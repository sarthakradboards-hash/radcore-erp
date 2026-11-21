'use client';
// Editing a draft delivery return (RAD-125): it is rewritten whole. A posted return is never edited (it is cancelled).
import { getDeliveryReturn, listDeliveryReturns, updateDeliveryReturn } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { ReturnForm } from '../../return-form.tsx';
import { batchKey } from '../../return-values.ts';

export default function EditDeliveryReturnPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getDeliveryReturn, { id });
  const update = useApiMutation(updateDeliveryReturn, { invalidates: [getDeliveryReturn, listDeliveryReturns] });
  const ret = q.data;
  const back = <p><Link href={`/sales/delivery-returns/${id}`}>{t('sales.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.missing')}</p></>;
  if (ret === undefined) return <p>{t('loading')}</p>;
  if (ret.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-return">{t('sales.return.edit.title')}</h1>
      <ReturnForm labelledBy="edit-return" submit={t('sales.return.save')}
        initial={{ deliveryId: ret.deliveryId, locationId: ret.locationId, businessDate: ret.businessDate, notes: ret.notes ?? '',
          lines: ret.lines.map((l) => ({
            deliveryLineId: l.deliveryLineId, itemId: l.itemId, qty: asWritten(l.qty), serials: [...l.serials],
            pick: Object.fromEntries(l.batches.map((b) => [batchKey(b.batchId), asWritten(b.qty)])),
          })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('sales.return.saved')), 0);
          router.push(`/sales/delivery-returns/${id}`);
        }} />
    </>
  );
}
