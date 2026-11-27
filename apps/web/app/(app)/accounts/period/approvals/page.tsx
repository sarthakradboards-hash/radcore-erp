'use client';
// Unlock approvals (RAD-168 on RAD-157's `period-unlock` approval routes, RAD-38; D-06): requests to move the period lock
// back or reopen a year, oldest first, for someone other than the asker holding books:unlock. A request shows what
// approving does, read from its version (the kind, the date the lock goes back to, the reason, and the lock now), and
// approves exactly that version or rejects it with a reason. The server refuses the asker, a request the lock moved past
// (`changed`), and anything the closes no longer allow; the screen only words those refusals.
import { financialYear, formatDate, formatMoment } from '@radcore/lib-common';
import { getPeriodContract, periodUnlockApproval } from '@radcore/lib-accounts/contract';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { PERIOD_MESSAGES, readUnlock } from '../years.ts';

const { listPending, getApproval, decide } = periodUnlockApproval;
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };
const who = (p: Pending['requestedBy']) => p.displayName ?? t('books.period.someone');

function Review({ request }: { request: Pending }) {
  const q = useApiQuery(getApproval, { id: request.id });
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, getPeriodContract] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const headingId = useId();
  const a = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  const v = readUnlock(a.version);
  // Approve is offered only for a version the screen could show, and only while it's still the one asked.
  const mayApprove = v !== null && !a.changed;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('books.unlocks.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('books.unlocks.changed')}</p> : null}
      {v === null ? <p role="alert" className="kit-form-alert">{t('books.unlocks.unreadable')}</p> : (
        <dl className="admin-facts" aria-label={t('books.unlocks.figures')}>
          <dt>{t('books.unlocks.kind')}</dt>
          <dd>{v.kind === 'move_back' ? t('books.unlocks.kind.move_back') : t('books.unlocks.kind.reopen_year', { year: financialYear(v.through).label })}</dd>
          <dt>{t('books.unlocks.through')}</dt><dd>{formatDate(v.through)}</dd>
          <dt>{t('books.unlocks.now')}</dt><dd>{v.lockedThrough === null ? t('books.period.notLocked') : formatDate(v.lockedThrough)}</dd>
          <dt>{t('books.unlocks.reason')}</dt><dd>{v.reason}</dd>
        </dl>
      )}
      {a.status !== 'pending' ? <p>{t(`books.unlocks.status.${a.status}`)}</p> : (
        <div className="kit-actions">
          {mayApprove
            ? <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('books.unlocks.approve')}</button>
            : null}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('books.unlocks.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={PERIOD_MESSAGES} title={t('books.unlocks.approve.title')}
        body={t('books.unlocks.approve.body')} action={t('books.unlocks.approve')} done={t('books.unlocks.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={PERIOD_MESSAGES} title={t('books.unlocks.reject.title')}
        action={t('books.unlocks.reject')} done={t('books.unlocks.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

export default function UnlockApprovalsPage() {
  const mayDecide = useMe().permissions.includes('books:unlock');
  const list = useApiList(listPending, { filter: {} }, { enabled: mayDecide });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'when', header: t('books.unlocks.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('books.unlocks.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('books.unlocks.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        aria-label={t('books.unlocks.review.for', { who: who(r.requestedBy) })}>{t('books.unlocks.review')}</button>
    ) },
  ];
  return (
    <>
      <h1>{t('books.unlocks.title')}</h1>
      <p>{t('books.unlocks.intro')}</p>
      {!mayDecide ? <p>{t('books.unlocks.none')}</p> : (
        <>
          <DataTable caption={t('books.unlocks.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('books.unlocks.empty')} />
          {open === null ? null : <Review key={open.id} request={open} />}
        </>
      )}
    </>
  );
}
