'use client';
// Editing a draft delivery (RAD-125): it is rewritten whole. A posted delivery is never edited (it is cancelled).
import { getDelivery, listDeliveries, updateDelivery } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMe } from '../../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { DeliveryForm } from '../../delivery-form.tsx';
import { batchKey } from '../../stock-pick.tsx';

export default function EditDeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('deliveries:write');
  const q = useApiQuery(getDelivery, { id });
  const update = useApiMutation(updateDelivery, { invalidates: [getDelivery, listDeliveries] });
  const delivery = q.data;
  const back = <p><Link href={`/sales/deliveries/${id}`}>{t('sales.back')}</Link></p>;
  if (!mayWrite) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.delivery.err.forbidden')}</p></>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.missing')}</p></>;
  if (delivery === undefined) return <p>{t('loading')}</p>;
  if (delivery.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-delivery">{t('sales.delivery.edit.title')}</h1>
      <DeliveryForm labelledBy="edit-delivery" submit={t('sales.delivery.save')}
        initial={{ orderId: delivery.orderId, locationId: delivery.locationId, businessDate: delivery.businessDate, notes: delivery.notes ?? '',
          lines: delivery.lines.map((l) => ({
            orderLineId: l.orderLineId, itemId: l.itemId, label: `${l.name} (${l.sku})`, qty: asWritten(l.qty), serials: [...l.serials],
            pick: Object.fromEntries(l.batches.map((b) => [batchKey(b.batchId), asWritten(b.qty)])),
          })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('sales.delivery.saved')), 0);
          router.push(`/sales/deliveries/${id}`);
        }} />
    </>
  );
}
