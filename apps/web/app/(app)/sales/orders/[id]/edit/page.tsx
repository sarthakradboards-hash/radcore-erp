'use client';
// Editing an order (RAD-125): a draft is rewritten whole, and a confirmed order's lines too, through the checks again
// (ADR-007 §1): the server may ask for an override, or refuse what has already been delivered. A closed or cancelled
// order is no longer edited.
import { getOrder, listOrders, updateOrder } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../../admin/decimal.ts';
import { DocumentForm } from '../../../document-form.tsx';

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getOrder, { id });
  const update = useApiMutation(updateOrder, { invalidates: [getOrder, listOrders] });
  const order = q.data;
  const back = <p><Link href={`/sales/orders/${id}`}>{t('sales.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.missing')}</p></>;
  if (order === undefined) return <p>{t('loading')}</p>;
  if (order.status !== 'draft' && order.status !== 'confirmed') {
    return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  }
  return (
    <>
      {back}
      <h1 id="edit-order">{t('sales.order.edit.title')}</h1>
      <DocumentForm labelledBy="edit-order" quote={false} submit={t('sales.order.save')} party={{ id: order.partyId, name: order.partyName }}
        initial={{ partyId: order.partyId, businessDate: order.businessDate, validUntil: '', notes: order.notes ?? '',
          lines: order.lines.map((l) => ({ itemId: l.itemId, qty: asWritten(l.qty), rate: asPrice(l.rate), discountPercent: asWritten(l.discountPercent) })) }}
        onSubmit={async ({ partyId, businessDate, notes, lines }) => {
          await update.submit({ id, partyId, businessDate, notes, lines });
          setTimeout(() => announce(t('sales.order.saved')), 0);
          router.push(`/sales/orders/${id}`);
        }} />
    </>
  );
}
