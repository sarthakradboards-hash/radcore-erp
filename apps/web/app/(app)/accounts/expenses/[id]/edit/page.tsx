'use client';
// A draft expense rewritten whole (RAD-168 on RAD-152's replaceExpense). A posted or cancelled one isn't a draft any more.
// One waiting for approval can still be changed: its request then shows as changed, and can only be rejected.
import { expenseCashApproval, getExpense, listExpenses, replaceExpense } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMe } from '../../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { ExpenseForm } from '../../expense-form.tsx';
import { expenseTitle } from '../../expense-values.ts';
import { expenseToForm } from '../../form-values.ts';

export default function EditExpensePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const may = useMe().permissions.includes('expenses:write');
  const q = useApiQuery(getExpense, { id });
  const replace = useApiMutation(replaceExpense, { invalidates: [getExpense, listExpenses, expenseCashApproval.listPending] });
  const e = q.data;
  const back = <p><Link href={`/accounts/expenses/${id}`}>{t('books.expense.form.back')}</Link></p>;
  if (!may) return <>{back}<p>{t('books.expense.form.cannot')}</p></>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('books.expense.missing')}</p></>;
  if (e === undefined) return <p>{t('loading')}</p>;
  if (e.status !== 'draft') return <>{back}<p>{t('books.expense.form.notDraft')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-expense">{t('books.expense.form.edit', { title: expenseTitle(e) })}</h1>
      {e.awaitingApproval ? <p className="admin-notice">{t('books.expense.form.awaiting')}</p> : null}
      <ExpenseForm labelledBy="edit-expense" initial={expenseToForm(e)}
        supplier={e.supplierId === null || e.supplierName === null ? null : { id: e.supplierId, name: e.supplierName }}
        submit={t('books.expense.form.save')}
        onSubmit={async (v) => {
          await replace.submit({ id, ...v });
          setTimeout(() => announce(t('books.expense.form.saved')), 0);
          router.push(`/accounts/expenses/${id}`);
        }} />
    </>
  );
}
