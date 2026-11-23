'use client';
// One stock adjustment (RAD-144 on RAD-141's contracts), in the record layout: where it is, its lines in or out with their
// batches, serials (and a found unit's chassis number and condition) and value at cost, and what can be done next. A draft
// is edited, sent for someone else's approval, or deleted; nothing changes in stock until it's approved. A posted one is
// cancelled by its mirror (stock:approve). The server says whether each still may.
import { formatDate } from '@radcore/lib-common';
import {
  cancelStockAdjustment, deleteStockAdjustment, getStockAdjustment, listStockAdjustments, requestStockAdjustmentApproval,
  stockAdjustmentApproval,
} from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';
import { asWritten } from '../../../admin/decimal.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { CancelDocDialog, docSteps, STOCK_MESSAGES, Value } from '../../shared.tsx';

type Dialogs = 'send' | 'delete' | 'cancel' | null;

export default function StockAdjustmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const q = useApiQuery(getStockAdjustment, { id });
  const again = [getStockAdjustment, listStockAdjustments, stockAdjustmentApproval.listPending];
  const send = useApiMutation(requestStockAdjustmentApproval, { invalidates: again });
  const cancel = useApiMutation(cancelStockAdjustment, { invalidates: again });
  const remove = useApiMutation(deleteStockAdjustment, { invalidates: [listStockAdjustments, stockAdjustmentApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const captionId = useId();
  const a = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/stock/adjustments">{t('stock.adjustment.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('stock.adjustment.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (a === undefined) return <p>{t('loading')}</p>;
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const draft = a.status === 'draft';
  return (
    <>
      <p><Link href="/stock/adjustments">{t('stock.adjustment.back')}</Link></p>
      <h1>{a.number === null ? t('stock.adjustment.title.draft') : t('stock.adjustment.title', { number: a.number })}</h1>
      <StatusBar label={t('stock.status.step')} steps={docSteps(a.status)} current={a.status} />
      {draft ? <p className="admin-notice">{t(a.approval === 'pending' ? 'stock.approval.pending' : 'stock.approval.none')}</p> : null}
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.place')}</dt><dd>{a.locationName}</dd>
        <dt>{t('stock.date')}</dt><dd>{formatDate(a.businessDate)}</dd>
        <dt>{t('stock.reason')}</dt><dd>{a.reason}</dd>
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.line.item')}</th>
                <th scope="col">{t('stock.adjustment.direction')}</th>
                <th scope="col" className="kit-numeric">{t('stock.adjustment.qty')}</th>
                <th scope="col">{t('stock.line.batch')}</th>
                <th scope="col">{t('stock.line.serials')}</th>
                <th scope="col">{t('stock.adjustment.condition')}</th>
                <th scope="col" className="kit-numeric">{t('stock.line.value')}</th>
              </tr>
            </thead>
            <tbody>
              {a.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td>{t(l.direction === 'in' ? 'stock.adjustment.direction.in' : 'stock.adjustment.direction.out')}</td>
                  <td className="kit-numeric">{asWritten(l.qty)}</td>
                  <td>{l.batches.map((b) => `${b.batchNo ?? t('stock.batch.none')} (${asWritten(b.qty)})`).join(', ')}</td>
                  <td>{l.serials.map((s) => (s.chassisNo === null ? s.serialNo : `${s.serialNo} / ${s.chassisNo}`)).join(', ')}</td>
                  <td>{l.condition === null ? '' : t(`stock.adjustment.condition.${l.condition}`)}</td>
                  <td className="kit-numeric"><Value x={l.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="kit-actions">
        {draft && permissions.includes('stock:count') ? (
          <>
            <Link className="kit-button" href={`/stock/adjustments/${id}/edit`}>{t('stock.edit')}</Link>
            {a.approval === 'pending' ? null
              : <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('send')}>{t('stock.send')}</button>}
            <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('stock.delete')}</button>
          </>
        ) : null}
        {a.status === 'posted' && permissions.includes('stock:approve')
          ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('stock.cancelDoc')}</button> : null}
      </div>
      <ConfirmDialog open={dialog === 'send'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.send.title')}
        body={t('stock.send.body')} action={t('stock.send')} done={t('stock.sent')} onConfirm={async () => { await send.submit({ id }); }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.delete.title')}
        body={t('stock.delete.body')} action={t('stock.delete')} done={t('stock.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/stock/adjustments'); }} />
      <CancelDocDialog open={dialog === 'cancel'} onOpenChange={shut} onCancel={(v) => cancel.submit({ id, ...v })} />
    </>
  );
}
