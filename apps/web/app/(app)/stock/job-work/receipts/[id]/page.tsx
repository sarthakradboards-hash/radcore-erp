'use client';
// One job work receipt (RAD-144 on RAD-142's contracts): which challan it answers, where the goods came in, and line by line
// what was made (with the job worker's charge), used, back and lost. Values at cost are masked without cost:read; the charge is
// the job worker's, so it's shown. job_work:write cancels one while its goods are still where they went and no bill names it.
import { dec, formatDate, formatMoney } from '@radcore/lib-common';
import { cancelJobWorkReceipt, getJobWorkChallan, getJobWorkReceipt, listJobWorkChallans, listJobWorkReceipts } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from '../../../../../../components/shell/session-provider.tsx';
import { StatusBar } from '../../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import '../../../../../../components/ui/table/table.css';
import { asWritten } from '../../../../admin/decimal.ts';
import { CancelDocDialog, statusName, Value } from '../../../shared.tsx';

/** Posted at once with its number, so the bar starts there; a cancelled one's runs on to Cancelled. */
const steps = (status: 'posted' | 'cancelled') => (status === 'cancelled' ? ['posted', 'cancelled'] as const : ['posted'] as const)
  .map((key) => ({ key, label: statusName(key) }));
type Part = { qty: string; batches: readonly { batchNo: string | null; qty: string }[]; serials: readonly string[] };
/** A part as one cell: its quantity, then its batches and units when there are any. */
const partText = (p: Part) => (dec(p.qty).isZero() ? '' : [asWritten(p.qty),
  ...p.batches.map((b) => `${b.batchNo ?? t('stock.batch.none')} (${asWritten(b.qty)})`), ...p.serials].join(', '));

export default function JobWorkReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const mayWrite = useMe().permissions.includes('job_work:write');
  const q = useApiQuery(getJobWorkReceipt, { id });
  const cancel = useApiMutation(cancelJobWorkReceipt, { invalidates: [getJobWorkReceipt, listJobWorkReceipts, getJobWorkChallan, listJobWorkChallans] });
  const [cancelling, setCancelling] = useState(false);
  const captionId = useId();
  const r = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/stock/job-work/receipts">{t('stock.jobWork.receipt.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('stock.jobWork.receipt.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (r === undefined) return <p>{t('loading')}</p>;
  return (
    <>
      <p><Link href="/stock/job-work/receipts">{t('stock.jobWork.receipt.back')}</Link></p>
      <h1>{t('stock.jobWork.receipt', { number: r.number })}</h1>
      <StatusBar label={t('stock.status.step')} steps={steps(r.status)} current={r.status} />
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.jobWork.receipt.challan')}</dt><dd><Link href={`/stock/job-work/${r.challanId}`}>{r.challanNumber}</Link></dd>
        <dt>{t('stock.jobWork.party')}</dt><dd>{r.partyName}</dd>
        <dt>{t('stock.jobWork.receipt.to')}</dt><dd>{r.locationName}</dd>
        <dt>{t('stock.date')}</dt><dd>{formatDate(r.businessDate)}</dd>
        <dt>{t('stock.jobWork.receipt.charges')}</dt><dd>{formatMoney(r.charges)}</dd>
        {r.notes === null ? null : <><dt>{t('stock.jobWork.notes')}</dt><dd>{r.notes}</dd></>}
        {r.cancelReason === null ? null : <><dt>{t('stock.jobWork.cancelReason')}</dt><dd>{r.cancelReason}</dd></>}
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.jobWork.receipt.input')}</th>
                <th scope="col">{t('stock.jobWork.receipt.made')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.receipt.charge')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.receipt.madeValue')}</th>
                <th scope="col">{t('stock.jobWork.receipt.part.used')}</th>
                <th scope="col">{t('stock.jobWork.receipt.part.back')}</th>
                <th scope="col">{t('stock.jobWork.receipt.part.lost')}</th>
                <th scope="col" className="kit-numeric">{t('stock.jobWork.receipt.lostValue')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.input.name} ({l.input.sku})</td>
                  <td>{l.made === null ? '' : [`${l.made.name} (${l.made.sku}) ${asWritten(l.made.qty)}`, ...l.made.serials].join(', ')}</td>
                  <td className="kit-numeric">{l.made === null ? '' : formatMoney(l.made.charge)}</td>
                  <td className="kit-numeric">{l.made === null ? '' : <Value x={l.made.value} />}</td>
                  <td>{partText(l.used)}</td>
                  <td>{partText(l.back)}</td>
                  <td>{partText(l.lost)}</td>
                  <td className="kit-numeric">{dec(l.lost.qty).isZero() ? '' : <Value x={l.lost.value} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {mayWrite && r.status === 'posted' ? (
        <div className="kit-actions">
          <button type="button" className="kit-button" onClick={() => setCancelling(true)}>{t('stock.cancelDoc')}</button>
        </div>
      ) : null}
      <CancelDocDialog open={cancelling} onOpenChange={setCancelling} onCancel={(v) => cancel.submit({ id, ...v })} />
    </>
  );
}
