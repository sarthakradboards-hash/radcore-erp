'use client';
// Quotes (RAD-125 on RAD-112's contracts): what was offered to each customer, newest first, a page at a time and
// filtered by status. sales:write starts a new one; its page sends it, records the answer, or turns it into an order.
import { SALES_QUOTE_STATUSES } from '@radcore/lib-common';
import { listQuotes } from '@radcore/lib-sales/contract';
import { formatDate, formatMoney } from '@radcore/lib-common';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, type QuoteRow } from '../shared.tsx';
import { StatusCounts } from '../status-counts.tsx';

type Show = (typeof SALES_QUOTE_STATUSES)[number] | 'all';

const columns: Column<QuoteRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (q) => <Link href={`/sales/quotes/${q.id}`}>{numberText(q.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (q) => q.partyName },
  { id: 'date', header: t('sales.date'), cell: (q) => formatDate(q.businessDate) },
  { id: 'valid', header: t('sales.quote.validUntil'), cell: (q) => (q.validUntil === null ? t('sales.quote.noValidUntil') : formatDate(q.validUntil)) },
  { id: 'total', header: t('sales.col.total'), numeric: true, cell: (q) => (q.total === null ? '' : formatMoney(q.total)) },
  { id: 'status', header: t('sales.status'), cell: (q) => t(`sales.quote.status.${q.status}`) },
];

export default function QuotesPage() {
  const mayWrite = useMe().permissions.includes('sales:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listQuotes, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.quotes.title')}</h1>
      <p>{t('sales.quotes.intro')}</p>
      <StatusCounts kind="quote" />
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...SALES_QUOTE_STATUSES.map((s) => ({ value: s, label: t(`sales.quote.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/quotes/new">{t('sales.quotes.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.quotes.title')} columns={columns} rowKey={(q) => q.id} list={list} empty={t('sales.quotes.empty')} />
    </>
  );
}
