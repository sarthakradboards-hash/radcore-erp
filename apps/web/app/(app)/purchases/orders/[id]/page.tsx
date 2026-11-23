'use client';
// One purchase order (RAD-143 on RAD-136's contracts), in the record layout: where it is (the status bar), its facts,
// lines and amounts, and what can be done next. A draft is edited, placed or deleted; placing within the placer's limit
// places it at once, above it asks for someone else's approval (the draft then waits, awaitingApproval). A placed PO's
// lines change, it's printed, closed short with a reason, or cancelled with one while nothing has come in.
// purchasing:write does all of it; the server says whether it still may.
import { formatDate, formatMoney, stateName } from '@radcore/lib-common';
import {
  cancelPurchaseOrder, closePurchaseOrder, deletePurchaseOrder, getPurchaseOrder, listPurchaseOrders, placePurchaseOrder,
  printPurchaseOrder, purchaseOrderApproval,
} from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { CountCards, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { PrintButtons } from '../../../sales/print-buttons.tsx';
import { AmountsSummary } from '../../../sales/shared.tsx';
import { numberText, OrderLines, orderSteps, PURCHASE_MESSAGES } from '../../shared.tsx';

type Dialogs = 'place' | 'delete' | 'close' | 'cancel' | null;

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('purchasing:write');
  const q = useApiQuery(getPurchaseOrder, { id });
  const again = [getPurchaseOrder, listPurchaseOrders, purchaseOrderApproval.listPending];
  const place = useApiMutation(placePurchaseOrder, { invalidates: again });
  const close = useApiMutation(closePurchaseOrder, { invalidates: again });
  const cancel = useApiMutation(cancelPurchaseOrder, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the lists are refreshed (as the sales screens do).
  const remove = useApiMutation(deletePurchaseOrder, { invalidates: [listPurchaseOrders, purchaseOrderApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const po = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/purchases/orders">{t('purchases.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('purchases.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (po === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const editable = po.status === 'draft' || po.status === 'placed';
  return (
    <>
      <p><Link href="/purchases/orders">{t('purchases.back')}</Link></p>
      <h1>{po.number === null ? t('purchases.order.title.draft') : t('purchases.order.title', { number: po.number })}</h1>
      <StatusBar label={t('purchases.status.step')} steps={orderSteps(po.status)} current={po.status} />
      {po.awaitingApproval ? <p className="admin-notice">{t('purchases.order.awaiting')}</p> : null}
      <CountCards label={t('purchases.order.counts')} cards={[
        { label: t('purchases.order.count.lines'), value: String(po.lines.length) },
        ...(po.amounts.total === null ? [] : [{ label: t('sales.amounts.total'), value: formatMoney(po.amounts.total) }]),
      ]} />
      <dl className="admin-facts" aria-label={t('purchases.order.facts')}>
        <dt>{t('purchases.order.supplier')}</dt><dd>{po.supplierName}</dd>
        <dt>{t('purchases.order.date')}</dt><dd>{formatDate(po.businessDate)}</dd>
        <dt>{t('purchases.order.expectedBy')}</dt><dd>{po.expectedBy === null ? t('purchases.none') : formatDate(po.expectedBy)}</dd>
        {po.amounts.placeOfSupply === null ? null
          : <><dt>{t('sales.amounts.placeOfSupply')}</dt><dd>{stateName(po.amounts.placeOfSupply) ?? po.amounts.placeOfSupply}</dd></>}
        {po.approvedTotal === null ? null : <><dt>{t('purchases.order.approvedTotal')}</dt><dd>{formatMoney(po.approvedTotal)}</dd></>}
        <dt>{t('purchases.order.notes')}</dt><dd>{po.notes ?? t('purchases.order.noNotes')}</dd>
        {po.closedReason === null ? null : <><dt>{t('purchases.order.closedReason')}</dt><dd>{po.closedReason}</dd></>}
      </dl>
      <OrderLines number={po.number} lines={po.lines} />
      <AmountsSummary number={numberText(po.number)} amounts={po.amounts} />
      {po.status === 'draft' ? null : <div className="kit-actions"><PrintButtons contract={printPurchaseOrder} id={id} /></div>}
      {mayWrite && editable ? (
        <div className="kit-actions">
          <Link className="kit-button" href={`/purchases/orders/${id}/edit`}>{t(po.status === 'draft' ? 'purchases.edit' : 'purchases.editLines')}</Link>
          {po.status === 'draft' ? (
            <>
              {po.awaitingApproval ? null
                : <button type="button" className="kit-button kit-button-primary" onClick={open('place')}>{t('purchases.place')}</button>}
              <button type="button" className="kit-button" onClick={open('delete')}>{t('purchases.delete')}</button>
            </>
          ) : (
            <button type="button" className="kit-button" onClick={open('close')}>{t('purchases.close')}</button>
          )}
          <button type="button" className="kit-button" onClick={open('cancel')}>{t('purchases.cancelOrder')}</button>
        </div>
      ) : null}

      <ConfirmDialog open={dialog === 'place'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.place.title')}
        body={t('purchases.place.body')} action={t('purchases.place')} done={t('purchases.sentForApproval')}
        onConfirm={async () => {
          const r = await place.submit({ id });
          return r.status === 'placed' && r.number !== null ? t('purchases.placed', { number: r.number }) : t('purchases.sentForApproval');
        }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.delete.title')}
        body={t('purchases.delete.body')} action={t('purchases.delete')} done={t('purchases.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/purchases/orders'); }} />
      <ReasonDialog open={dialog === 'close'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.close.title')}
        action={t('purchases.close')} done={t('purchases.closed')} onConfirm={(reason) => close.submit({ id, reason })} />
      <ReasonDialog open={dialog === 'cancel'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.cancel.title')}
        action={t('purchases.cancelOrder')} done={t('purchases.cancelled')} onConfirm={(reason) => cancel.submit({ id, reason })} />
    </>
  );
}
