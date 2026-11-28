'use client';
// Expense cash approvals (RAD-168 on RAD-152's `expense-cash` approval routes, ADR-007 §8, RAD-38): expenses paid in cash
// past the day's limit, oldest first, for someone other than the asker holding payments:approve. What approving posts is
// read from the approval's own version, so what's shown is what's approved; Approve posts the expense, or Reject with a
// reason leaves it a draft. The server re-checks everything; the screen words its refusals.
import { formatDate, formatMoment, formatMoney } from '@radcore/lib-common';
import { expenseCashApproval, getExpense, listExpenses } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { useMoneyAccounts } from '../../../sales/money-accounts.ts';
import { EXPENSE_MESSAGES, namingLine, readCashVersion } from '../expense-values.ts';
import { LinesTable } from '../lines-table.tsx';

const { listPending, getApproval, decide } = expenseCashApproval;
type Pending = { id: string; recordId: string; requestedAt: string; requestedBy: { displayName: string | null } };
const who = (p: Pending['requestedBy']) => p.displayName ?? t('books.expense.someone');
const href = (id: string) => `/accounts/expenses/${id}`;

function Review({ request }: { request: Pending }) {
  const q = useApiQuery(getApproval, { id: request.id });
  // The supplier's name isn't in the version; the expense gives it.
  const expense = useApiQuery(getExpense, { id: request.recordId });
  const accounts = useMoneyAccounts();
  const decided = useApiMutation(decide, { invalidates: [listPending, getApproval, getExpense, listExpenses] });
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const close = (open: boolean) => {
    if (open) return;
    setActing(null);
    setTimeout(() => { if (approveButton.current?.isConnected !== true) heading.current?.focus(); }, 0);
  };
  const a = q.data;
  const v = a === undefined ? null : readCashVersion(a.version);
  // Approve only for figures on screen, with the supplier they're owed to named, and only while they're still current.
  const mayApprove = a !== undefined && v !== null && !a.changed && expense.data !== undefined;
  const hadApprove = useRef(false);
  useEffect(() => {
    if (hadApprove.current && !mayApprove) heading.current?.focus();
    hadApprove.current = mayApprove;
  }, [mayApprove]);
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (a === undefined) return <p>{t('loading')}</p>;
  const paidFrom = !Array.isArray(accounts) ? undefined : accounts.find((x) => x.value === v?.payFromAccountId)?.label;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>{t('books.expense.approvals.heading', { who: who(a.requestedBy), when: formatMoment(a.requestedAt) })}</h2>
      <p><Link href={href(a.recordId)}>{t('books.expense.approvals.open')}</Link></p>
      {a.changed ? <p role="alert" className="kit-form-alert">{t('books.expense.approvals.changed')}</p> : null}
      {expense.error !== null ? <p role="alert" className="kit-form-alert">{t('books.expense.approvals.cannotRead')}</p> : null}
      {v === null ? <p role="alert" className="kit-form-alert">{t('books.expense.approvals.unreadable')}</p> : (
        <>
          <dl className="admin-facts" aria-label={t('books.expense.approvals.figures')}>
            <dt>{t('books.expense.supplier')}</dt>
            <dd>{expense.data === undefined ? t('loading') : expense.data.supplierName ?? t('books.expense.noSupplier')}</dd>
            <dt>{t('books.expense.supplierBill')}</dt><dd>{v.supplierInvoiceNumber}, {formatDate(v.supplierInvoiceDate)}</dd>
            <dt>{t('books.expense.col.date')}</dt><dd>{formatDate(v.businessDate)}</dd>
            <dt>{t('books.expense.col.paid')}</dt><dd>{paidFrom ?? t('books.expense.atOnce')}</dd>
            <dt>{t('books.expense.col.total')}</dt><dd>{formatMoney(v.statedTotal)}</dd>
          </dl>
          <LinesTable caption={t('books.expense.lines')} lines={v.lines} />
        </>
      )}
      {a.status !== 'pending' ? <p>{t(`books.expense.approvals.status.${a.status}`)}</p> : (
        <div className="kit-actions">
          {mayApprove
            ? <button ref={approveButton} type="button" className="kit-button kit-button-primary" onClick={() => setActing('approve')}>{t('books.expense.approvals.approve')}</button>
            : null}
          <button type="button" className="kit-button" onClick={() => setActing('reject')}>{t('books.expense.approvals.reject')}</button>
        </div>
      )}
      <ConfirmDialog open={acting === 'approve'} onOpenChange={close} messages={EXPENSE_MESSAGES} title={t('books.expense.approvals.approve.title')}
        body={t('books.expense.approvals.approve.body')} action={t('books.expense.approvals.approve')} done={t('books.expense.approvals.approved')}
        onConfirm={async () => {
          // A refusal re-reads the request, so the figures and Approve follow what changed.
          await decided.submit({ id: a.id, decision: 'approve', versionHash: a.versionHash })
            .catch((e: unknown) => { void q.refetch(); throw namingLine(e); });
        }} />
      <ReasonDialog open={acting === 'reject'} onOpenChange={close} messages={EXPENSE_MESSAGES} title={t('books.expense.approvals.reject.title')}
        action={t('books.expense.approvals.reject')} done={t('books.expense.approvals.rejected')}
        onConfirm={async (reason) => { await decided.submit({ id: a.id, decision: 'reject', reason }); }} />
    </section>
  );
}

export default function ExpenseApprovalsPage() {
  const { permissions } = useMe();
  // Deciding needs the expense read too (the supplier's name, its page).
  const mayDecide = permissions.includes('payments:approve') && permissions.includes('expenses:read');
  const list = useApiList(listPending, { filter: {} }, { enabled: mayDecide });
  const [open, setOpen] = useState<Pending | null>(null);
  const columns: Column<Pending>[] = [
    { id: 'when', header: t('books.expense.approvals.col.when'), cell: (r) => formatMoment(r.requestedAt) },
    { id: 'who', header: t('books.expense.approvals.col.who'), cell: (r) => who(r.requestedBy) },
    { id: 'review', header: t('books.expense.approvals.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={open?.id === r.id} onClick={() => setOpen(r)}
        // Numbered, since two requests by one person in one minute would otherwise share a name.
        aria-label={t('books.expense.approvals.review.for', { n: String(list.items.findIndex((x) => x.id === r.id) + 1), who: who(r.requestedBy), when: formatMoment(r.requestedAt) })}>{t('books.expense.approvals.review')}</button>
    ) },
  ];
  return (
    <>
      <h1>{t('books.expense.approvals.title')}</h1>
      <p>{t('books.expense.approvals.intro')}</p>
      {!mayDecide ? <p>{t('books.expense.approvals.none')}</p> : (
        <>
          <DataTable caption={t('books.expense.approvals.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('books.expense.approvals.empty')} />
          {open === null ? null : <Review key={open.id} request={open} />}
        </>
      )}
    </>
  );
}
