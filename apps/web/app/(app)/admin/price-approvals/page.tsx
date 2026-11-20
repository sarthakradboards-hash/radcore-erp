'use client';
// Price-list approvals (RAD-99 on RAD-98 and RAD-38): the drafts waiting, oldest first. prices:approve (which the server
// grants only to a session signed in with the second factor) opens one, sees what it changes against the prices in
// force, and approves exactly that version or rejects it with a reason. The server refuses its own maker, an approver
// too new to approve, and a draft changed since it was sent; the screen only words those refusals.
import { formatMoment } from '@radcore/lib-common';
import { getPriceList, getPriceListChanges, listPriceLists, priceListApproval } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { PriceChanges } from '../price-lists/changes.tsx';
import { ConfirmDialog, MESSAGES } from '../shared.tsx';
import type { PendingApproval as Pending } from '../types.ts';

const { listPending, getApproval, decide } = priceListApproval;
/** Who sent it, by name; never the raw id. */
const who = (p: Pending['requestedBy']) => p.displayName ?? t('admin.audit.unknown');
const CODES = ['own_request', 'approver_too_new', 'version_changed', 'not_pending'] as const;
const APPROVAL_MESSAGES = { ...MESSAGES, ...Object.fromEntries(CODES.map((c) => [c, t(`admin.approvals.err.${c}`)])) };

function Review({ request }: { request: Pending }) {
  const q = useApiQuery(getApproval, { id: request.id });
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, listPriceLists, getPriceList] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const a = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby="review">
      <h2 id="review">{t('admin.approvals.review', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('admin.approvals.changed')}</p> : null}
      <PriceChanges versionId={a.recordId} />
      {a.status !== 'pending' ? <p>{t(`admin.approvals.status.${a.status}`)}</p> : (
      <div className="kit-actions">
        {a.changed ? null : (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('admin.approvals.approve')}</button>
        )}
        <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('admin.approvals.reject')}</button>
      </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={APPROVAL_MESSAGES}
        title={t('admin.approvals.approve.title')} body={t('admin.approvals.approve.body')} action={t('admin.approvals.approve')}
        done={t('admin.approvals.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={APPROVAL_MESSAGES}
        title={t('admin.approvals.reject.title')} action={t('admin.approvals.reject')} done={t('admin.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

/** The list a request is for, read with the same query the review shows its changes with. */
function ListName({ versionId }: { versionId: string }) {
  return useApiQuery(getPriceListChanges, { id: versionId }).data?.name ?? '…';
}

/** "Review", named for its list so each row's button says which. */
function ReviewButton({ request, pressed, onPress }: { request: Pending; pressed: boolean; onPress: () => void }) {
  const name = useApiQuery(getPriceListChanges, { id: request.recordId }).data?.name ?? '';
  return (
    <button type="button" className="kit-button" aria-pressed={pressed} onClick={onPress}
      aria-label={t('admin.approvals.openFor', { name, who: who(request.requestedBy) })}>{t('admin.approvals.open')}</button>
  );
}

export default function PriceApprovalsPage() {
  const list = useApiList(listPending, { filter: {} });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'list', header: t('admin.approvals.col.list'), cell: (r) => <ListName versionId={r.recordId} /> },
    { id: 'when', header: t('admin.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('admin.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'open', header: t('admin.users.col.actions'),
      cell: (r) => <ReviewButton request={r} pressed={open?.id === r.id} onPress={() => setOpen(r)} /> },
  ];
  return (
    <>
      <h1>{t('admin.approvals.title')}</h1>
      <p>{t('admin.approvals.intro')}</p>
      <DataTable caption={t('admin.approvals.caption')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('admin.approvals.empty')} />
      {open === null ? null : <Review key={open.id} request={open} />}
    </>
  );
}
