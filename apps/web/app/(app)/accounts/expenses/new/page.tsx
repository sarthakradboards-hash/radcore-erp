'use client';
// A new expense (RAD-168 on RAD-152's createExpense), saved as a draft under expenses:write; it's posted on its page.
import { createExpense, listExpenses } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ExpenseForm } from '../expense-form.tsx';
import { blankExpense } from '../form-values.ts';

export default function NewExpensePage() {
  const { permissions } = useMe();
  const may = permissions.includes('expenses:write') && permissions.includes('expenses:read');
  const router = useRouter();
  const create = useApiMutation(createExpense, { invalidates: [listExpenses] });
  const [initial] = useState(blankExpense);
  return (
    <>
      <p><Link href="/accounts/expenses">{t('books.expense.back')}</Link></p>
      <h1 id="new-expense">{t('books.expense.form.new')}</h1>
      {!may ? <p>{t('books.expense.form.cannot')}</p> : (
        <ExpenseForm labelledBy="new-expense" initial={initial} submit={t('books.expense.form.save')}
          onSubmit={async (v) => {
            const { id } = await create.submit(v);
            setTimeout(() => announce(t('books.expense.form.saved')), 0);
            router.push(`/accounts/expenses/${id}`);
          }} />
      )}
    </>
  );
}
