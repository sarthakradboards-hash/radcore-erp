'use client';
// Expenses (RAD-168 on RAD-152's routes, ADR-009 §3): a supplier's bill for a cost, newest first, a page at a time, filtered
// by status. expenses:read. Each opens on its own page, where expenses:write posts, deletes or cancels it.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listExpenses } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { expenseTitle } from './expense-values.ts';

type Row = z.output<typeof listExpenses.output>['items'][number];
type Show = Row['status'] | 'all';

const columns: Column<Row>[] = [
  { id: 'date', header: t('books.expense.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'number', header: t('books.expense.col.number'), cell: (r) => <Link href={`/accounts/expenses/${r.id}`}>{expenseTitle(r)}</Link> },
  { id: 'supplier', header: t('books.expense.supplier'), cell: (r) => r.supplierName ?? t('books.expense.noSupplier') },
  { id: 'invoice', header: t('books.expense.supplierBill'), cell: (r) => r.supplierInvoiceNumber },
  { id: 'paid', header: t('books.expense.col.paid'), cell: (r) => t(r.onCredit ? 'books.expense.onCredit' : 'books.expense.atOnce') },
  { id: 'total', header: t('books.expense.col.total'), numeric: true, cell: (r) => formatMoney(r.statedTotal) },
  { id: 'status', header: t('books.expense.col.status'),
    cell: (r) => t(r.awaitingApproval ? 'books.expense.status.awaiting' : `books.expense.status.${r.status}`) },
];

export default function ExpensesPage() {
  const mayRead = useMe().permissions.includes('expenses:read');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listExpenses, { filter: show === 'all' ? {} : { status: show } }, { enabled: mayRead });
  return (
    <>
      <h1>{t('books.expense.title')}</h1>
      <p>{t('books.expense.intro')}</p>
      {!mayRead ? <p>{t('books.expense.none')}</p> : (
        <>
          <div className="admin-toolbar">
            <ChoiceButtons<Show> label={t('books.expense.col.status')} value={show} onChange={setShow} options={[
              { value: 'all', label: t('books.expense.all') },
              ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: t(`books.expense.status.${s}`) })),
            ]} />
          </div>
          <DataTable caption={t('books.expense.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('books.expense.empty')} />
        </>
      )}
    </>
  );
}
