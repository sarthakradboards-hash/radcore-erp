'use client';
// One expense (RAD-168 on RAD-152's routes, ADR-009 §3, §7): the supplier's bill as entered, its lines with the credit the
// server claimed, and the bill file to download. Under expenses:write a draft is posted (cash past the day's limit waits for
// an owner's override, which posts it) or deleted, and a posted one is cancelled by a mirror entry, dated, with a reason.
import { dateString, formatDate, formatMoment, formatMoney, indiaDate, reason as reasonString } from '@radcore/lib-common';
import { cancelExpense, dropExpense, expenseCashApproval, getExpense, listExpenses, postExpense } from '@radcore/lib-accounts/contract';
import { expenseBillFiles } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { StatusBar } from '../../../../../components/ui/record/record.tsx';
import { ApiError, callContract } from '../../../../../lib/api-client.ts';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { useMoneyAccounts } from '../../../sales/money-accounts.ts';
import { afterDelete, EXPENSE_MESSAGES, expenseTitle, namingLine } from '../expense-values.ts';
import { LinesTable } from '../lines-table.tsx';

type Dialogs = 'post' | 'delete' | 'cancel' | null;
const cancelSchema = z.object({ businessDate: dateString(), reason: reasonString() });

/** The bill as it came: a short-lived link from the server, followed in this tab. A refusal is said, not lost. */
function BillFile({ id }: { id: string }) {
  const [problem, setProblem] = useState('');
  return (
    <>
      <button type="button" className="kit-button" onClick={() => {
        setProblem('');
        callContract(expenseBillFiles.downloadLink, { id }, { idempotencyKey: crypto.randomUUID() }).then(({ url }) => window.location.assign(url))
          .catch((e: unknown) => setProblem(e instanceof ApiError ? e.envelope.message : t('books.expense.file.failed')));
      }}>{t('books.expense.file.download')}</button>
      {problem === '' ? null : <span role="alert" className="kit-form-alert">{problem}</span>}
    </>
  );
}

export default function ExpensePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('expenses:write');
  const q = useApiQuery(getExpense, { id });
  const accounts = useMoneyAccounts();
  const again = [getExpense, listExpenses, expenseCashApproval.listPending];
  const post = useApiMutation(postExpense, { invalidates: again });
  const cancel = useApiMutation(cancelExpense, { invalidates: again });
  const remove = useApiMutation(dropExpense, { invalidates: [listExpenses, expenseCashApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  // Posting or cancelling takes the pressed button away, so focus goes to the heading rather than falling to the body.
  const heading = useRef<HTMLHeadingElement>(null);
  const toHeading = () => setTimeout(() => heading.current?.focus(), 0);
  const e = q.data;
  const back = <p><Link href="/accounts/expenses">{t('books.expense.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('books.expense.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (e === undefined) return <p>{t('loading')}</p>;
  const shut = (open: boolean) => { if (!open) setDialog(null); };
  const draft = e.status === 'draft';
  const paidFrom = !Array.isArray(accounts) ? undefined : accounts.find((a) => a.value === e.payFromAccountId)?.label;
  const steps = (e.status === 'cancelled' ? ['draft', 'posted', 'cancelled'] as const : ['draft', 'posted'] as const)
    .map((key) => ({ key, label: t(`books.expense.status.${key}`) }));
  return (
    <>
      {back}
      <h1 ref={heading} tabIndex={-1}>{expenseTitle(e)}</h1>
      <StatusBar label={t('books.expense.col.status')} steps={steps} current={e.status} />
      {e.awaitingApproval ? <p className="admin-notice">{t('books.expense.awaiting')}</p> : null}
      {draft && e.fileId === null ? <p className="admin-notice">{t('books.expense.noFile')}</p> : null}
      <dl className="admin-facts" aria-label={t('books.expense.facts')}>
        <dt>{t('books.expense.supplier')}</dt><dd>{e.supplierName ?? t('books.expense.noSupplier')}</dd>
        <dt>{t('books.expense.gstin')}</dt><dd>{e.supplierGstin ?? t('books.expense.noGstin')}</dd>
        <dt>{t('books.expense.supplierBill')}</dt><dd>{e.supplierInvoiceNumber}, {formatDate(e.supplierInvoiceDate)}</dd>
        <dt>{t('books.expense.col.date')}</dt><dd>{formatDate(e.businessDate)}</dd>
        <dt>{t('books.expense.col.paid')}</dt>
        <dd>{e.payFromAccountId === null ? t('books.expense.onCredit') : paidFrom ?? t('books.expense.atOnce')}</dd>
        <dt>{t('books.expense.col.total')}</dt><dd>{formatMoney(e.statedTotal)}</dd>
        {draft ? null : <><dt>{t('books.expense.tds')}</dt><dd>{formatMoney(e.tds)}</dd></>}
        <dt>{t('books.expense.recordedAt')}</dt><dd>{formatMoment(e.createdAt)}</dd>
        <dt>{t('books.expense.file')}</dt><dd>{e.fileId === null ? t('books.expense.file.none') : <BillFile id={e.fileId} />}</dd>
        {e.notes === null ? null : <><dt>{t('books.expense.notes')}</dt><dd>{e.notes}</dd></>}
        {e.cancelReason === null ? null : <><dt>{t('books.expense.cancelReason')}</dt><dd>{e.cancelReason}</dd></>}
      </dl>
      <LinesTable caption={t('books.expense.lines')} lines={e.lines} posted={!draft} />
      {mayWrite && e.status !== 'cancelled' ? (
        <div className="kit-actions">
          {draft && !e.awaitingApproval && e.fileId !== null
            ? <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('post')}>{t('books.expense.post')}</button> : null}
          {draft ? <Link className="kit-button" href={`/accounts/expenses/${id}/edit`}>{t('books.expense.form.editLink')}</Link> : null}
          {draft ? <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('books.expense.delete')}</button> : null}
          {e.status === 'posted' ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('books.expense.cancel')}</button> : null}
        </div>
      ) : null}

      <ConfirmDialog open={dialog === 'post'} onOpenChange={shut} messages={EXPENSE_MESSAGES} title={t('books.expense.post.title')}
        body={t('books.expense.post.body')} action={t('books.expense.post')} done={t('books.expense.sent')}
        onConfirm={async () => {
          const r = await post.submit({ id }).catch((x: unknown) => { throw namingLine(x); });
          toHeading();
          return r.status === 'posted' && r.number !== null ? t('books.expense.posted', { number: r.number }) : t('books.expense.sent');
        }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={EXPENSE_MESSAGES} title={t('books.expense.delete.title')}
        body={t('books.expense.delete.body')} action={t('books.expense.delete')} done={t('books.expense.deleted')}
        onConfirm={async () => { await remove.submit({ id }); afterDelete.focusList = true; router.push('/accounts/expenses'); }} />
      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('books.expense.cancel.title')} description={t('books.expense.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={EXPENSE_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => {
            await cancel.submit({ id, ...v });
            setDialog(null);
            setTimeout(() => { heading.current?.focus(); announce(t('books.expense.cancelled')); }, 0);
          }}>
          <TextField name="businessDate" label={t('books.expense.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('books.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('books.cancel')}</CloseButton>
            <SubmitButton>{t('books.expense.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
