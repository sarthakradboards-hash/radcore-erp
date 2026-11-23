'use client';
// To collect (RAD-126 on RAD-119's routes): every customer who owes something today, the most overdue first, then the most owed.
// receivables:read. Each opens the customer's statement; what is owed, what of it is overdue and since when are the server's figures.
import { formatDate, formatMoney, formatMoment } from '@radcore/lib-common';
import { listToCollect } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import type { z } from 'zod';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';

type Row = z.output<typeof listToCollect.output>['items'][number];

const columns: Column<Row>[] = [
  { id: 'party', header: t('books.collect.col.party'), cell: (r) => <Link href={`/accounts/collect/${r.partyId}`} aria-label={t('books.collect.statement', { party: r.name })}>{r.name}</Link> },
  { id: 'outstanding', header: t('books.collect.col.outstanding'), numeric: true, cell: (r) => formatMoney(r.outstanding) },
  { id: 'overdue', header: t('books.collect.col.overdue'), numeric: true, cell: (r) => formatMoney(r.overdue) },
  { id: 'oldest', header: t('books.collect.col.oldest'), cell: (r) => (r.oldestDue === null ? '' : formatDate(r.oldestDue)) },
  { id: 'reminded', header: t('books.collect.col.reminded'), cell: (r) => (r.lastReminderAt === null ? t('books.collect.never') : formatMoment(r.lastReminderAt)) },
];

export default function ToCollectPage() {
  const list = useApiList(listToCollect, { filter: {} });
  return (
    <>
      <h1>{t('books.collect.title')}</h1>
      <p>{t('books.collect.intro')}</p>
      <DataTable caption={t('books.collect.title')} columns={columns} rowKey={(r) => r.partyId} list={list} empty={t('books.collect.empty')} />
    </>
  );
}
