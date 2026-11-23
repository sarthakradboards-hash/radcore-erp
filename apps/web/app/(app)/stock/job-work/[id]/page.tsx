'use client';
// One job work challan (RAD-144 on RAD-142's contracts): what went to the job worker, and of each line what its receipts have
// accounted for (used, back, lost) and what's still out. job_work:write receives against an open one, cancels one no receipt
// answers, and prints it as Rule 55's delivery challan (statutory, so the job worker and values print in full).
import { formatDate } from '@radcore/lib-common';
import { cancelJobWorkChallan, getJobWorkChallan, listJobWorkChallans, listJobWorkReceipts, printJobWorkChallan } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';
import { asWritten } from '../../../admin/decimal.ts';
import { PrintButtons } from '../../../sales/print-buttons.tsx';
import { CancelDocDialog, statusName, Value } from '../../shared.tsx';

/** Posted at once with its number, so the bar starts there; a cancelled one's runs on to Cancelled. */
const steps = (status: 'posted' | 'cancelled') => (status === 'cancelled' ? ['posted', 'cancelled'] as const : ['posted'] as const)
  .map((key) => ({ key, label: statusName(key) }));

export default function JobWorkChallanPage() {
  const { id } = useParams<{ id: string }>();
  const mayWrite = useMe().permissions.includes('job_work:write');
  const q = useApiQuery(getJobWorkChallan, { id });
  const receipts = useApiList(listJobWorkReceipts, { filter: { challanId: id } }, { limit: 50 });
  const cancel = useApiMutation(cancelJobWorkChallan, { invalidates: [getJobWorkChallan, listJobWorkChallans] });
  const [cancelling, setCancelling] = useState(false);
  const captionId = useId();
  const c = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/stock/job-work">{t('stock.jobWork.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('stock.jobWork.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (c === undefined) return <p>{t('loading')}</p>;
  const posted = c.status === 'posted';
  return (
    <>
      <p><Link href="/stock/job-work">{t('stock.jobWork.back')}</Link></p>
      <h1>{t('stock.jobWork.challan', { number: c.number })}</h1>
      <StatusBar label={t('stock.status.step')} steps={steps(c.status)} current={c.status} />
      {posted && c.pastReturnDays ? <p role="alert" className="kit-form-alert">{t('stock.jobWork.lateNotice', { days: String(c.ageDays) })}</p> : null}
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.jobWork.from')}</dt><dd>{c.fromName}</dd>
        <dt>{t('stock.jobWork.party')}</dt><dd>{c.partyName}</dd>
        <dt>{t('stock.date')}</dt><dd>{formatDate(c.businessDate)}</dd>
        <dt>{t('stock.col.status')}</dt>
        <dd>{!posted ? t('stock.status.cancelled') : c.open ? t('stock.jobWork.openFor', { days: String(c.ageDays) }) : t('stock.jobWork.closed')}</dd>
        {c.notes === null ? null : <><dt>{t('stock.jobWork.notes')}</dt><dd>{c.notes}</dd></>}
        {c.cancelReason === null ? null : <><dt>{t('stock.jobWork.cancelReason')}</dt><dd>{c.cancelReason}</dd></>}
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.line.item')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.sent')}</th>
                <th scope="col">{t('stock.line.batch')}</th>
                <th scope="col">{t('stock.line.serials')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.used')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.back.col')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.lost')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.left')}</th>
                <th scope="col" className="kit-numeric">{t('stock.line.value')}</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td className="kit-numeric">{asWritten(l.qty)}</td>
                  <td>{l.batches.map((b) => `${b.batchNo ?? t('stock.batch.none')} (${asWritten(b.qty)})`).join(', ')}</td>
                  <td>{l.serials.join(', ')}</td>
                  <td className="kit-numeric">{asWritten(l.used)}</td>
                  <td className="kit-numeric">{asWritten(l.back)}</td>
                  <td className="kit-numeric">{asWritten(l.lost)}</td>
                  <td className="kit-numeric">{asWritten(l.left)}</td>
                  <td className="kit-numeric"><Value x={l.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h2>{t('stock.jobWork.receipts')}</h2>
      {receipts.items.length === 0 ? <p>{t('stock.jobWork.noReceipts')}</p> : (
        <ul>
          {receipts.items.map((r) => (
            <li key={r.id}>
              <Link href={`/stock/job-work/receipts/${r.id}`}>{r.number}</Link>, {formatDate(r.businessDate)}{r.status === 'cancelled' ? `, ${t('stock.status.cancelled')}` : ''}
            </li>
          ))}
        </ul>
      )}
      {receipts.hasNextPage ? (
        <button type="button" className="kit-button" disabled={receipts.isFetchingNextPage} onClick={receipts.fetchNextPage}>{t('stock.jobWork.moreReceipts')}</button>
      ) : null}
      {mayWrite ? (
        <div className="kit-actions">
          {posted && c.open ? <Link className="kit-button kit-button-primary" href={`/stock/job-work/receipts/new?challan=${c.id}`}>{t('stock.jobWork.receive')}</Link> : null}
          {posted ? <button type="button" className="kit-button" onClick={() => setCancelling(true)}>{t('stock.cancelDoc')}</button> : null}
          {posted ? <PrintButtons contract={printJobWorkChallan} id={id} /> : null}
        </div>
      ) : null}
      <CancelDocDialog open={cancelling} onOpenChange={setCancelling} onCancel={(v) => cancel.submit({ id, ...v })} />
    </>
  );
}
