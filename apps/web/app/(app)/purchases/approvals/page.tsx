'use client';
// Purchase order approvals (RAD-143 on RAD-136's approval routes, RAD-38): drafts placed above their placer's limit,
// oldest first, for someone else holding purchasing:approve. A request opens its PO and shows what approving places
// (the supplier and the total with GST, read from the PO itself), then approves exactly the version shown, which
// places it, or rejects it with a reason. The server refuses its own sender, an approver too new, a PO changed since it
// was asked, and anything approving re-checks (dates, tax, supplier, items); the screen only words those refusals.
import { formatMoment, formatMoney } from '@radcore/lib-common';
import { getPurchaseOrder, listPurchaseOrders, purchaseOrderApproval } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../admin/shared.tsx';
import { PURCHASE_MESSAGES } from '../shared.tsx';

const { listPending, getApproval, decide } = purchaseOrderApproval;
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };
/** Who asked, by name; never the raw id. */
const who = (p: Pending['requestedBy']) => p.displayName ?? t('purchases.approvals.someone');
const href = (id: string) => `/purchases/orders/${id}`;

/** What approving places: the supplier and the total with GST, from the PO as it is now. */
function Figures({ id }: { id: string }) {
  const po = useApiQuery(getPurchaseOrder, { id }).data;
  if (po === undefined) return null;
  return (
    <dl className="admin-facts" aria-label={t('purchases.approvals.figures')}>
      <dt>{t('purchases.approvals.supplier')}</dt><dd>{po.supplierName}</dd>
      <dt>{t('purchases.approvals.total')}</dt><dd>{po.amounts.total === null ? t('purchases.none') : formatMoney(po.amounts.total)}</dd>
    </dl>
  );
}

function Review({ request }: { request: Pending }) {
  const q = useApiQuery(getApproval, { id: request.id });
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, getPurchaseOrder, listPurchaseOrders] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const headingId = useId();
  const a = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('purchases.approvals.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      <p><Link href={href(a.recordId)}>{t('purchases.approvals.open')}</Link></p>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('purchases.approvals.changed')}</p> : null}
      <Figures id={a.recordId} />
      {a.status !== 'pending' ? <p>{t(`purchases.approvals.status.${a.status}`)}</p> : (
        <div className="kit-actions">
          {a.changed ? null : (
            <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('purchases.approvals.approve')}</button>
          )}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('purchases.approvals.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={PURCHASE_MESSAGES} title={t('purchases.approvals.approve.title')}
        body={t('purchases.approvals.approve.body')} action={t('purchases.approvals.approve')} done={t('purchases.approvals.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={PURCHASE_MESSAGES} title={t('purchases.approvals.reject.title')}
        action={t('purchases.approvals.reject')} done={t('purchases.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

export default function PurchaseApprovalsPage() {
  const mayDecide = useMe().permissions.includes('purchasing:approve');
  const list = useApiList(listPending, { filter: {} }, { enabled: mayDecide });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'order', header: t('purchases.approvals.col.order'), cell: (r) => <Link href={href(r.recordId)}>{t('purchases.approvals.open')}</Link> },
    { id: 'when', header: t('purchases.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('purchases.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('purchases.approvals.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        aria-label={t('purchases.approvals.review.for', { who: who(r.requestedBy) })}>{t('purchases.approvals.review')}</button>
    ) },
  ];
  return (
    <>
      <h1>{t('purchases.approvals.title')}</h1>
      <p>{t('purchases.approvals.intro')}</p>
      {!mayDecide ? <p>{t('purchases.approvals.none')}</p> : (
        <>
          <DataTable caption={t('purchases.approvals.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('purchases.approvals.empty')} />
          {open === null ? null : <Review key={open.id} request={open} />}
        </>
      )}
    </>
  );
}
