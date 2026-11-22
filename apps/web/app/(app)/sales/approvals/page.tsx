'use client';
// Sales approvals (RAD-125 on RAD-38's approval routes): what is waiting for someone other than its sender, oldest first,
// one queue for each kind the person may decide: the overrides of an order's, a delivery's or an invoice's checks
// (sales:override), and credit notes (credit_notes:approve, which posts them). Both keys the server grants only to a session
// signed in with the second factor. A request opens its document, shows what the checks found, and approves exactly the
// version shown or rejects it with a reason. The server refuses its own sender, an approver too new, and a document changed
// since it was sent; the screen only words those refusals.
import { formatMoment, formatMoney } from '@radcore/lib-common';
import { listAccounts } from '@radcore/lib-accounts/contract';
import {
  creditNoteApproval, deliveryOverrideApproval, getCreditNote, getDelivery, getInvoice, getOrder, invoiceOverrideApproval,
  listCreditNotes, listDeliveries, listInvoices, listOrders, orderOverrideApproval,
} from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../admin/shared.tsx';
import './approvals.css';
import { issueWords } from '../issue-words.ts';
import { SALES_MESSAGES } from '../shared.tsx';

const KINDS = [
  { key: 'order', perm: 'sales:override', approval: orderOverrideApproval, href: (id: string) => `/sales/orders/${id}`,
    refresh: [getOrder, listOrders] },
  { key: 'delivery', perm: 'sales:override', approval: deliveryOverrideApproval, href: (id: string) => `/sales/deliveries/${id}`,
    refresh: [getDelivery, listDeliveries] },
  { key: 'invoice', perm: 'sales:override', approval: invoiceOverrideApproval, href: (id: string) => `/sales/invoices/${id}`,
    refresh: [getInvoice, listInvoices] },
  { key: 'credit', perm: 'credit_notes:approve', approval: creditNoteApproval, href: (id: string) => `/sales/credit-notes/${id}`,
    refresh: [getCreditNote, listCreditNotes] },
] as const;
type Kind = (typeof KINDS)[number];
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };

const CODES = ['own_request', 'approver_too_new', 'version_changed', 'not_pending', 'credit_not_posted'] as const;
const MESSAGES = { ...SALES_MESSAGES, ...Object.fromEntries(CODES.map((c) => [c, t(`sales.approvals.err.${c}`)])) };
/** Who sent it, by name; never the raw id. */
const who = (p: Pending['requestedBy']) => p.displayName ?? t('admin.audit.unknown');

/** What approving a credit note does with money: its total, the counter refund it pays and from which account, and whether it is late
 * (past section 34's limit, so the GST on it is borne). Read from the note itself, since approving posts it. */
function CreditFigures({ id }: { id: string }) {
  const note = useApiQuery(getCreditNote, { id }).data;
  const accounts = useApiQuery(listAccounts, {}).data?.items;
  if (note === undefined) return null;
  const refund = note.refund;
  const account = refund === null ? undefined : accounts?.find((a) => a.id === refund.accountId)?.name;
  return (
    <dl className="admin-facts" aria-label={t('sales.approvals.credit.figures')}>
      <dt>{t('sales.approvals.credit.total')}</dt><dd>{formatMoney(note.total)}</dd>
      <dt>{t('sales.approvals.credit.refund.label')}</dt>
      <dd>{refund === null ? t('sales.approvals.credit.refund.none')
        : account === undefined ? formatMoney(refund.amount) : t('sales.approvals.credit.refund', { amount: formatMoney(refund.amount), account })}</dd>
      {note.late ? <><dt>{t('sales.approvals.credit.late')}</dt><dd>{t('sales.approvals.credit.late.yes')}</dd></> : null}
    </dl>
  );
}

/** The issues an override's version names, in the screen's words (the server sends each with its own code). */
function Issues({ version }: { version: unknown }) {
  const headingId = useId();
  const issues = typeof version === 'object' && version !== null && 'issues' in version && Array.isArray(version.issues) ? version.issues : [];
  const codes = issues.flatMap((i: unknown) => (typeof i === 'object' && i !== null && 'code' in i && typeof i.code === 'string' ? [i.code] : []));
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{t('sales.approvals.issues')}</h3>
      {codes.length === 0 ? <p>{t('sales.approvals.issues.none')}</p> : (
        <ul>{codes.map((c, n) => <li key={n}>{issueWords(c)}</li>)}</ul>
      )}
    </section>
  );
}

function Review({ kind, request }: { kind: Kind; request: Pending }) {
  const { getApproval, decide, listPending } = kind.approval;
  const q = useApiQuery(getApproval, { id: request.id });
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, ...kind.refresh] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const a = q.data;
  const credit = kind.key === 'credit';
  const headingId = useId();
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('sales.approvals.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      <p><Link href={kind.href(a.recordId)}>{t('sales.approvals.open.doc', { doc: t(`sales.approvals.doc.${kind.key}`) })}</Link></p>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('sales.approvals.changed')}</p> : null}
      {credit ? <><p>{t('sales.approvals.credit.note')}</p><CreditFigures id={a.recordId} /></> : <Issues version={a.version} />}
      {a.status !== 'pending' ? <p>{t(`sales.approvals.status.${a.status}`)}</p> : (
        <div className="kit-actions">
          {a.changed ? null : (
            <button type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('sales.approvals.approve')}</button>
          )}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('sales.approvals.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={MESSAGES}
        title={t(credit ? 'sales.approvals.approve.credit.title' : 'sales.approvals.approve.override.title')}
        body={t(credit ? 'sales.approvals.approve.credit.body' : 'sales.approvals.approve.override.body')} action={t('sales.approvals.approve')}
        done={t('sales.approvals.approved')}
        onConfirm={async () => { await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash }); }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={MESSAGES}
        title={t('sales.approvals.reject.title')} action={t('sales.approvals.reject')} done={t('sales.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

function Queue({ kind }: { kind: Kind }) {
  const list = useApiList(kind.approval.listPending, { filter: {} });
  const [open, setOpen] = useState<Pending | null>(null);
  const doc = t(`sales.approvals.doc.${kind.key}`);
  const columns: Column<Pending>[] = [
    { id: 'doc', header: t('sales.approvals.col.document'), cell: (r) => <Link className="sales-approvals-link" href={kind.href(r.recordId)}>{t('sales.approvals.open.doc', { doc })}</Link> },
    { id: 'when', header: t('sales.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('sales.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('admin.users.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        aria-label={t('sales.approvals.review.for', { doc, who: who(r.requestedBy) })}>{t('sales.approvals.review')}</button>
    ) },
  ];
  return (
    <section aria-labelledby={`q-${kind.key}`}>
      <h2 id={`q-${kind.key}`}>{t(`sales.approvals.kind.${kind.key}`)}</h2>
      <DataTable caption={t(`sales.approvals.kind.${kind.key}`)} columns={columns} rowKey={(r) => r.id} list={list} empty={t('sales.approvals.empty')} />
      {open === null ? null : <Review key={open.id} kind={kind} request={open} />}
    </section>
  );
}

export default function SalesApprovalsPage() {
  const { permissions } = useMe();
  const mine = KINDS.filter((k) => permissions.includes(k.perm));
  return (
    <>
      <h1>{t('sales.approvals.title')}</h1>
      <p>{t('sales.approvals.intro')}</p>
      {mine.length === 0 ? <p>{t('sales.approvals.none')}</p> : mine.map((k) => <Queue key={k.key} kind={k} />)}
    </>
  );
}
