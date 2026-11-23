'use client';
// One stock transfer (RAD-144 on RAD-141's contracts), in the record layout: from where to where, why, and its lines with their
// batches, serials and value at cost. A posted one is undone by its mirror (stock:move), refused once the goods have moved on
// (RC-124). One into a franchisee's place that waits for approval is a draft: it's sent again after a refusal, or deleted.
import { formatDate } from '@radcore/lib-common';
import {
  cancelStockTransfer, deleteStockTransfer, getStockTransfer, listStockTransfers, requestStockTransferApproval, stockTransferApproval,
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

export default function StockTransferPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayMove = useMe().permissions.includes('stock:move');
  const q = useApiQuery(getStockTransfer, { id });
  const again = [getStockTransfer, listStockTransfers, stockTransferApproval.listPending];
  const send = useApiMutation(requestStockTransferApproval, { invalidates: again });
  const cancel = useApiMutation(cancelStockTransfer, { invalidates: again });
  const remove = useApiMutation(deleteStockTransfer, { invalidates: [listStockTransfers, stockTransferApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const captionId = useId();
  const tr = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/stock/transfers">{t('stock.transfer.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('stock.transfer.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (tr === undefined) return <p>{t('loading')}</p>;
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const draft = tr.status === 'draft';
  return (
    <>
      <p><Link href="/stock/transfers">{t('stock.transfer.back')}</Link></p>
      <h1>{tr.number === null ? t('stock.transfer.title.draft') : t('stock.transfer.title', { number: tr.number })}</h1>
      <StatusBar label={t('stock.status.step')} steps={docSteps(tr.status)} current={tr.status} />
      {draft ? <p className="admin-notice">{t(tr.approval === 'pending' ? 'stock.approval.pending' : 'stock.approval.none')}</p> : null}
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.transfer.from')}</dt><dd>{tr.fromName}</dd>
        <dt>{t('stock.transfer.to')}</dt><dd>{tr.toName}</dd>
        <dt>{t('stock.date')}</dt><dd>{formatDate(tr.businessDate)}</dd>
        <dt>{t('stock.reason')}</dt><dd>{tr.reason}</dd>
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.line.item')}</th>
                <th scope="col" className="kit-numeric">{t('stock.transfer.qty')}</th>
                <th scope="col">{t('stock.line.batch')}</th>
                <th scope="col">{t('stock.line.serials')}</th>
                <th scope="col" className="kit-numeric">{t('stock.line.value')}</th>
              </tr>
            </thead>
            <tbody>
              {tr.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td className="kit-numeric">{asWritten(l.qty)}</td>
                  <td>{l.batches.map((b) => `${b.batchNo ?? t('stock.batch.none')} (${asWritten(b.qty)})`).join(', ')}</td>
                  <td>{l.serials.join(', ')}</td>
                  <td className="kit-numeric"><Value x={l.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {mayMove ? (
        <div className="kit-actions">
          {draft && tr.approval !== 'pending'
            ? <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('send')}>{t('stock.transfer.resend')}</button> : null}
          {draft ? <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('stock.delete')}</button> : null}
          {tr.status === 'posted' ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('stock.cancelDoc')}</button> : null}
        </div>
      ) : null}
      <ConfirmDialog open={dialog === 'send'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.send.title')}
        body={t('stock.send.body')} action={t('stock.transfer.resend')} done={t('stock.sent')} onConfirm={async () => { await send.submit({ id }); }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.delete.title')}
        body={t('stock.delete.body')} action={t('stock.delete')} done={t('stock.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/stock/transfers'); }} />
      <CancelDocDialog open={dialog === 'cancel'} onOpenChange={shut} onCancel={(v) => cancel.submit({ id, ...v })} />
    </>
  );
}
