'use client';
// Stock transfers (RAD-144 on RAD-141's contracts): newest first, a page at a time, filtered by status. stock:move starts one.
import { formatDate } from '@radcore/lib-common';
import { listStockTransfers } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, statusName, type DocStatus } from '../shared.tsx';

type Row = z.output<typeof listStockTransfers.output>['items'][number];
type Show = DocStatus | 'all';
const columns: Column<Row>[] = [
  { id: 'number', header: t('stock.col.number'), cell: (r) => <Link href={`/stock/transfers/${r.id}`}>{numberText(r.number)}</Link> },
  { id: 'from', header: t('stock.transfer.from'), cell: (r) => r.fromName },
  { id: 'to', header: t('stock.transfer.to'), cell: (r) => r.toName },
  { id: 'date', header: t('stock.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('stock.col.status'), cell: (r) => statusName(r.status) },
];

export default function StockTransfersPage() {
  const mayMove = useMe().permissions.includes('stock:move');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listStockTransfers, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('stock.transfers.title')}</h1>
      <p>{t('stock.transfers.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('stock.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('stock.all') }, ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: statusName(s) })),
        ]} />
        {mayMove ? <Link className="kit-button kit-button-primary" href="/stock/transfers/new">{t('stock.transfers.new')}</Link> : null}
      </div>
      <DataTable caption={t('stock.transfers.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('stock.transfers.empty')} />
    </>
  );
}
