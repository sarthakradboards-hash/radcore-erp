'use client';
// One stock count (RAD-144 on RAD-141's contracts), in the record layout: where it is, what was found against the books and
// the difference that posts (worked out by the server, on read while a draft), and what can be done next. A draft is edited,
// sent for someone else's approval, or deleted; nothing changes in stock until it's approved (flow 7). A posted count is
// cancelled by its mirror (stock:approve). The server says whether each still may.
import { formatDate, formatMoment } from '@radcore/lib-common';
import {
  cancelStockCount, deleteStockCount, getStockCount, listStockCounts, requestStockCountApproval, stockCountApproval,
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

export default function StockCountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const q = useApiQuery(getStockCount, { id });
  const again = [getStockCount, listStockCounts, stockCountApproval.listPending];
  const send = useApiMutation(requestStockCountApproval, { invalidates: again });
  const cancel = useApiMutation(cancelStockCount, { invalidates: again });
  const remove = useApiMutation(deleteStockCount, { invalidates: [listStockCounts, stockCountApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const captionId = useId();
  const c = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/stock/counts">{t('stock.count.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('stock.count.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (c === undefined) return <p>{t('loading')}</p>;
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const draft = c.status === 'draft';
  return (
    <>
      <p><Link href="/stock/counts">{t('stock.count.back')}</Link></p>
      <h1>{c.number === null ? t('stock.count.title.draft') : t('stock.count.title', { number: c.number })}</h1>
      <StatusBar label={t('stock.status.step')} steps={docSteps(c.status)} current={c.status} />
      {draft ? <p className="admin-notice">{t(c.approval === 'pending' ? 'stock.approval.pending' : 'stock.approval.none')}</p> : null}
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.place')}</dt><dd>{c.locationName}</dd>
        <dt>{t('stock.count.countedAt')}</dt><dd>{formatMoment(c.countedAt)}</dd>
        <dt>{t('stock.date')}</dt><dd>{formatDate(c.businessDate)}</dd>
        <dt>{t('stock.reason')}</dt><dd>{c.reason}</dd>
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.line.item')}</th>
                <th scope="col">{t('stock.line.batch')}</th>
                <th scope="col" className="kit-numeric">{t('stock.count.found')}</th>
                <th scope="col" className="kit-numeric">{t('stock.count.book')}</th>
                <th scope="col" className="kit-numeric">{t('stock.count.difference')}</th>
                <th scope="col">{t('stock.line.serials')}</th>
                <th scope="col" className="kit-numeric">{t('stock.line.value')}</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td>{l.batchNo ?? t('stock.batch.none')}</td>
                  <td className="kit-numeric">{asWritten(l.found)}</td>
                  <td className="kit-numeric">{asWritten(l.book)}</td>
                  <td className="kit-numeric">{asWritten(l.difference)}</td>
                  <td>{l.serials.join(', ')}</td>
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
            <Link className="kit-button" href={`/stock/counts/${id}/edit`}>{t('stock.edit')}</Link>
            {c.approval === 'pending' ? null
              : <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('send')}>{t('stock.send')}</button>}
            <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('stock.delete')}</button>
          </>
        ) : null}
        {c.status === 'posted' && permissions.includes('stock:approve')
          ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('stock.cancelDoc')}</button> : null}
      </div>
      <ConfirmDialog open={dialog === 'send'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.send.title')}
        body={t('stock.send.body')} action={t('stock.send')} done={t('stock.sent')} onConfirm={async () => { await send.submit({ id }); }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={STOCK_MESSAGES} title={t('stock.delete.title')}
        body={t('stock.delete.body')} action={t('stock.delete')} done={t('stock.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/stock/counts'); }} />
      <CancelDocDialog open={dialog === 'cancel'} onOpenChange={shut} onCancel={(v) => cancel.submit({ id, ...v })} />
    </>
  );
}
