'use client';
// Editing a purchase order (RAD-143): a draft is rewritten whole; a placed one keeps its supplier and date and changes its
// lines, which the server refuses above what was approved or the placer's limit (over_approved) and below what has come
// in (po_received). A closed or cancelled PO isn't edited.
import { getPurchaseOrder, listPurchaseOrders, updatePurchaseOrder } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../../admin/decimal.ts';
import { PoForm } from '../../po-form.tsx';

export default function EditPurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getPurchaseOrder, { id });
  const update = useApiMutation(updatePurchaseOrder, { invalidates: [getPurchaseOrder, listPurchaseOrders] });
  const po = q.data;
  const back = <p><Link href={`/purchases/orders/${id}`}>{t('purchases.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('purchases.missing')}</p></>;
  if (po === undefined) return <p>{t('loading')}</p>;
  if (po.status !== 'draft' && po.status !== 'placed') return <>{back}<p role="alert" className="kit-form-alert">{t('purchases.err.wrong_status')}</p></>;
  const placed = po.status === 'placed';
  return (
    <>
      {back}
      <h1 id="edit-po">{t(placed ? 'purchases.order.editLines.title' : 'purchases.order.edit.title')}</h1>
      <PoForm labelledBy="edit-po" placed={placed} submit={t(placed ? 'purchases.order.saveLines' : 'purchases.order.save')}
        supplier={{ id: po.supplierId, name: po.supplierName }}
        initial={{ supplierId: po.supplierId, businessDate: po.businessDate, expectedBy: po.expectedBy ?? '', notes: po.notes ?? '',
          lines: po.lines.map((l) => ({ itemId: l.itemId, qty: asWritten(l.qty), rate: asPrice(l.rate) })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('purchases.order.saved')), 0);
          router.push(`/purchases/orders/${id}`);
        }} />
    </>
  );
}
