'use client';
// Payments (RAD-126 on RAD-116's read routes): receipts, payments and refunds, newest first, a page at a time, filtered by what they
// are and where they stand. payments:read (all-only). The reference is shown in full: it is an approval code, a UTR or a cheque number,
// never card digits. payments:write records a new one.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listPaymentsContract } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';

type Row = z.output<typeof listPaymentsContract.output>['items'][number];
const KINDS = ['receipt', 'payment', 'refund'] as const;
const STATUSES = ['draft', 'posted', 'cancelled'] as const;

const columns: Column<Row>[] = [
  { id: 'date', header: t('books.pay.list.col.date'), cell: (p) => formatDate(p.businessDate) },
  { id: 'number', header: t('books.pay.list.col.number'), cell: (p) => <Link href={`/accounts/payments/${p.id}`}>{p.number ?? t('books.pay.list.waiting')}</Link> },
  { id: 'kind', header: t('books.pay.list.col.kind'), cell: (p) => t(`books.pay.kind.short.${p.kind}`) },
  { id: 'party', header: t('books.pay.list.col.party'), cell: (p) => p.partyName },
  { id: 'amount', header: t('books.pay.list.col.amount'), numeric: true, cell: (p) => formatMoney(p.amount) },
  { id: 'account', header: t('books.pay.list.col.account'), cell: (p) => p.accountName },
  { id: 'reference', header: t('books.pay.list.col.reference'), cell: (p) => p.reference ?? '' },
  { id: 'status', header: t('books.pay.list.col.status'), cell: (p) => t(`books.pay.status.${p.status}`) },
];

export default function PaymentsPage() {
  const mayWrite = useMe().permissions.includes('payments:write');
  const [kind, setKind] = useState<(typeof KINDS)[number] | 'all'>('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number] | 'all'>('all');
  const list = useApiList(listPaymentsContract, { filter: { ...(kind === 'all' ? {} : { kind }), ...(status === 'all' ? {} : { status }) } });
  return (
    <>
      <h1>{t('books.pay.list.title')}</h1>
      <p>{t('books.pay.list.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons label={t('books.pay.list.col.kind')} value={kind} onChange={setKind} options={[
          { value: 'all', label: t('books.pay.list.all') }, ...KINDS.map((k) => ({ value: k, label: t(`books.pay.kind.short.${k}`) })),
        ]} />
        <ChoiceButtons label={t('books.pay.list.col.status')} value={status} onChange={setStatus} options={[
          { value: 'all', label: t('books.pay.list.all') }, ...STATUSES.map((s) => ({ value: s, label: t(`books.pay.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/accounts/payments/new">{t('books.pay.list.new')}</Link> : null}
      </div>
      <DataTable caption={t('books.pay.list.title')} columns={columns} rowKey={(p) => p.id} list={list} empty={t('books.pay.list.empty')} />
    </>
  );
}
