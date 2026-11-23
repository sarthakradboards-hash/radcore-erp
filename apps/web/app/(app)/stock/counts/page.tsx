'use client';
// Stock counts (RAD-144 on RAD-141's contracts): newest first, a page at a time, filtered by status. stock:count starts one;
// its page sends it for approval.
import { formatDate, formatMoment } from '@radcore/lib-common';
import { listStockCounts } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, statusName, type DocStatus } from '../shared.tsx';

type Row = z.output<typeof listStockCounts.output>['items'][number];
type Show = DocStatus | 'all';
const columns: Column<Row>[] = [
  { id: 'number', header: t('stock.col.number'), cell: (c) => <Link href={`/stock/counts/${c.id}`}>{numberText(c.number)}</Link> },
  { id: 'place', header: t('stock.col.place'), cell: (c) => c.locationName },
  { id: 'countedAt', header: t('stock.count.countedAt'), cell: (c) => formatMoment(c.countedAt) },
  { id: 'date', header: t('stock.col.date'), cell: (c) => formatDate(c.businessDate) },
  { id: 'status', header: t('stock.col.status'), cell: (c) => statusName(c.status) },
];

export default function StockCountsPage() {
  const mayCount = useMe().permissions.includes('stock:count');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listStockCounts, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('stock.counts.title')}</h1>
      <p>{t('stock.counts.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('stock.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('stock.all') }, ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: statusName(s) })),
        ]} />
        {mayCount ? <Link className="kit-button kit-button-primary" href="/stock/counts/new">{t('stock.counts.new')}</Link> : null}
      </div>
      <DataTable caption={t('stock.counts.title')} columns={columns} rowKey={(c) => c.id} list={list} empty={t('stock.counts.empty')} />
    </>
  );
}
