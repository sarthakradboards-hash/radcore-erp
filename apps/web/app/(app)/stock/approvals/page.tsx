'use client';
// Stock approvals (RAD-144 on RAD-141's approval routes, RAD-38): counts and adjustments waiting for someone other than their
// maker, oldest first, under stock:approve. A request opens its document, then approves exactly the version shown, which
// posts it, or rejects it with a reason. The server refuses its own sender, an approver too new, a document changed since it
// was asked, and anything posting re-checks (stock, serials, chassis numbers); the screen only words those refusals.
import { formatMoment } from '@radcore/lib-common';
import {
  getStockAdjustment, getStockCount, listStockAdjustments, listStockCounts, stockAdjustmentApproval, stockCountApproval,
} from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../admin/shared.tsx';
import { STOCK_MESSAGES } from '../shared.tsx';

const KINDS = [
  { key: 'count', approval: stockCountApproval, href: (id: string) => `/stock/counts/${id}`, refresh: [getStockCount, listStockCounts] },
  { key: 'adjustment', approval: stockAdjustmentApproval, href: (id: string) => `/stock/adjustments/${id}`, refresh: [getStockAdjustment, listStockAdjustments] },
] as const;
type Kind = (typeof KINDS)[number];
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };
const who = (p: Pending['requestedBy']) => p.displayName ?? t('stock.approvals.someone');

function Review({ kind, request }: { kind: Kind; request: Pending }) {
  const { getApproval, decide, listPending } = kind.approval;
  const q = useApiQuery(getApproval, { id: request.id });
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, ...kind.refresh] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const headingId = useId();
  const a = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{t('stock.approvals.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h3>
      <p><Link href={kind.href(a.recordId)}>{t('stock.approvals.open')}</Link></p>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('stock.approvals.changed')}</p> : null}
      {a.status !== 'pending' ? <p>{t(`stock.approvals.status.${a.status}`)}</p> : (
        <div className="kit-actions">
          {a.changed ? null
            : <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('stock.approvals.approve')}</button>}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('stock.approvals.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={STOCK_MESSAGES} title={t('stock.approvals.approve.title')}
        body={t('stock.approvals.approve.body')} action={t('stock.approvals.approve')} done={t('stock.approvals.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={STOCK_MESSAGES} title={t('stock.approvals.reject.title')}
        action={t('stock.approvals.reject')} done={t('stock.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

function Queue({ kind }: { kind: Kind }) {
  const list = useApiList(kind.approval.listPending, { filter: {} });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'doc', header: t('stock.approvals.col.doc'), cell: (r) => <Link href={kind.href(r.recordId)}>{t('stock.approvals.open')}</Link> },
    { id: 'when', header: t('stock.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('stock.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('stock.approvals.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        aria-label={t('stock.approvals.review.for', { who: who(r.requestedBy) })}>{t('stock.approvals.review')}</button>
    ) },
  ];
  return (
    <section aria-labelledby={`q-${kind.key}`}>
      <h2 id={`q-${kind.key}`}>{t(`stock.approvals.kind.${kind.key}`)}</h2>
      <DataTable caption={t(`stock.approvals.kind.${kind.key}`)} columns={columns} rowKey={(r) => r.id} list={list} empty={t('stock.approvals.empty')} />
      {open === null ? null : <Review key={open.id} kind={kind} request={open} />}
    </section>
  );
}

export default function StockApprovalsPage() {
  const mayDecide = useMe().permissions.includes('stock:approve');
  return (
    <>
      <h1>{t('stock.approvals.title')}</h1>
      <p>{t('stock.approvals.intro')}</p>
      {mayDecide ? KINDS.map((k) => <Queue key={k.key} kind={k} />) : <p>{t('stock.approvals.none')}</p>}
    </>
  );
}
