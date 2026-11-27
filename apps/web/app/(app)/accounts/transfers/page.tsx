'use client';
// Transfers between the company's own money accounts (RAD-168 on RAD-165's #432, F19), newest first, a page at a time, and
// filtered by account. payments:read; payments:write records a new one. The reference is the bank's (a slip or a UTR).
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listTransfersContract } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { useMoneyAccounts } from '../../sales/money-accounts.ts';

type Row = z.output<typeof listTransfersContract.output>['items'][number];

const columns: Column<Row>[] = [
  { id: 'date', header: t('books.transfers.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'number', header: t('books.transfers.col.number'), cell: (r) => <Link href={`/accounts/transfers/${r.id}`}>{r.number}</Link> },
  { id: 'from', header: t('books.transfers.col.from'), cell: (r) => r.from.name },
  { id: 'to', header: t('books.transfers.col.to'), cell: (r) => r.to.name },
  { id: 'amount', header: t('books.transfers.col.amount'), numeric: true, cell: (r) => formatMoney(r.amount) },
  { id: 'reference', header: t('books.transfers.col.reference'), cell: (r) => r.reference ?? '' },
  { id: 'status', header: t('books.transfers.col.status'), cell: (r) => t(`books.transfers.status.${r.status}`) },
];

export default function TransfersPage() {
  const mayWrite = useMe().permissions.includes('payments:write');
  const accounts = useMoneyAccounts();
  const [account, setAccount] = useState('all');
  const list = useApiList(listTransfersContract, { filter: account === 'all' ? {} : { accountId: account } });
  return (
    <>
      <h1>{t('books.transfers.title')}</h1>
      <p>{t('books.transfers.intro')}</p>
      <div className="admin-toolbar">
        {/* The filter needs the money accounts' names (money_accounts:read); without them the list shows them all. */}
        {Array.isArray(accounts) ? (
          <ChoiceButtons label={t('books.transfers.filter')} value={account} onChange={setAccount}
            options={[{ value: 'all', label: t('books.transfers.all') }, ...accounts]} />
        ) : null}
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/accounts/transfers/new">{t('books.transfers.new')}</Link> : null}
      </div>
      <DataTable caption={t('books.transfers.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('books.transfers.empty')} />
    </>
  );
}
