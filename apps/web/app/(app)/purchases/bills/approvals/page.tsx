'use client';
// Purchase bill approvals (RAD-143 on RAD-138's approval routes, RAD-38): bills with a line or charges past the tolerance, oldest
// first, for someone else holding bills:approve. A request shows what approving posts (the supplier's invoice, the totals, and the
// lines past the tolerance, read from the bill itself) and approves exactly the version shown, which posts it, or rejects it with
// a reason. Approve shows only once those figures are on screen (auditor-3 on #337). The server re-checks everything approving
// depends on; the screen only words its refusals.
import { formatMoment, formatMoney } from '@radcore/lib-common';
import { getPurchaseBill, listPurchaseBills, purchaseBillApproval } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../admin/decimal.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { PURCHASE_MESSAGES } from '../../shared.tsx';

const { listPending, getApproval, decide } = purchaseBillApproval;
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };
const who = (p: Pending['requestedBy']) => p.displayName ?? t('purchases.approvals.someone');
const href = (id: string) => `/purchases/bills/${id}`;

/** What approving posts: the supplier's invoice, the totals, and why it waits. */
function Figures({ id }: { id: string }) {
  const q = useApiQuery(getPurchaseBill, { id });
  const b = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('purchases.bill.approvals.cannotRead')}</p>;
  if (b === undefined) return <p>{t('loading')}</p>;
  const past = b.lines.flatMap((l) => (l.kind === 'goods' && l.overTolerance ? [l] : []));
  const pastJobWork = b.lines.flatMap((l) => (l.kind === 'job_work' && l.overTolerance === true ? [l] : []));
  return (
    <>
      <dl className="admin-facts" aria-label={t('purchases.approvals.figures')}>
        <dt>{t('purchases.approvals.supplier')}</dt><dd>{b.supplierName}</dd>
        <dt>{t('purchases.bill.supplierInvoice')}</dt><dd>{b.supplierInvoiceNumber}</dd>
        <dt>{t('purchases.bill.statedTotal')}</dt><dd>{formatMoney(b.statedTotal)}</dd>
        <dt>{t('purchases.bill.workedTotal')}</dt><dd>{b.amounts.total === null ? t('purchases.none') : formatMoney(b.amounts.total)}</dd>
      </dl>
      {past.length === 0 && pastJobWork.length === 0 ? null : (
        <ul aria-label={t('purchases.bill.approvals.why')}>
          {past.map((l) => (
            <li key={l.id}>{t(l.overPoRate === null ? 'purchases.bill.approvals.freeLine' : 'purchases.bill.approvals.line',
              { name: l.name, over: l.overPoRate === null ? '' : asWritten(l.overPoRate), po: l.poNumber })}</li>
          ))}
          {pastJobWork.map((l) => (
            <li key={l.id}>{t('purchases.bill.approvals.jobWorkLine', { name: l.name, over: l.overChargeRate === null ? '' : asWritten(l.overChargeRate),
              receipt: l.receiptNumber ?? '' })}</li>
          ))}
        </ul>
      )}
      {b.chargesOverTolerance ? <p>{t('purchases.bill.chargesPast')}</p> : null}
    </>
  );
}

function Review({ request }: { request: Pending }) {
  const q = useApiQuery(getApproval, { id: request.id });
  const shown = useApiQuery(getPurchaseBill, { id: request.recordId }).data !== undefined;
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, getPurchaseBill, listPurchaseBills] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const headingId = useId();
  const a = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('purchases.approvals.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      <p><Link href={href(a.recordId)}>{t('purchases.bill.approvals.open')}</Link></p>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('purchases.approvals.changed')}</p> : null}
      <Figures id={a.recordId} />
      {a.status !== 'pending' ? <p>{t(`purchases.approvals.status.${a.status}`)}</p> : !shown ? null : (
        // Neither decision is offered until the bill's figures are on screen: deciding needs the bill read (purchasing:read),
        // so a role that only approves would be refused either way (e2e-playwright on #397).
        <div className="kit-actions">
          {a.changed ? null : (
            <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('purchases.bill.approvals.approve')}</button>
          )}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('purchases.approvals.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={PURCHASE_MESSAGES} title={t('purchases.bill.approvals.approve.title')}
        body={t('purchases.bill.approvals.approve.body')} action={t('purchases.bill.approvals.approve')} done={t('purchases.bill.approvals.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={PURCHASE_MESSAGES} title={t('purchases.approvals.reject.title')}
        action={t('purchases.approvals.reject')} done={t('purchases.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

export default function PurchaseBillApprovalsPage() {
  const mayDecide = useMe().permissions.includes('bills:approve');
  const list = useApiList(listPending, { filter: {} }, { enabled: mayDecide });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'bill', header: t('purchases.bill.approvals.col.bill'), cell: (r) => <Link href={href(r.recordId)}>{t('purchases.bill.approvals.open')}</Link> },
    { id: 'when', header: t('purchases.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('purchases.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('purchases.approvals.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        aria-label={t('purchases.bill.approvals.review.for', { who: who(r.requestedBy) })}>{t('purchases.approvals.review')}</button>
    ) },
  ];
  return (
    <>
      <h1>{t('purchases.bill.approvals.title')}</h1>
      <p>{t('purchases.bill.approvals.intro')}</p>
      {!mayDecide ? <p>{t('purchases.bill.approvals.none')}</p> : (
        <>
          <DataTable caption={t('purchases.bill.approvals.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('purchases.bill.approvals.empty')} />
          {open === null ? null : <Review key={open.id} request={open} />}
        </>
      )}
    </>
  );
}
