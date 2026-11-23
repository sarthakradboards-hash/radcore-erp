'use client';
// Stock adjustments (RAD-144 on RAD-141's contracts): newest first, a page at a time, filtered by status. stock:count starts
// one; its page sends it for approval.
import { formatDate } from '@radcore/lib-common';
import { listStockAdjustments } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, statusName, type DocStatus } from '../shared.tsx';

type Row = z.output<typeof listStockAdjustments.output>['items'][number];
type Show = DocStatus | 'all';
const columns: Column<Row>[] = [
  { id: 'number', header: t('stock.col.number'), cell: (a) => <Link href={`/stock/adjustments/${a.id}`}>{numberText(a.number)}</Link> },
  { id: 'place', header: t('stock.col.place'), cell: (a) => a.locationName },
  { id: 'date', header: t('stock.col.date'), cell: (a) => formatDate(a.businessDate) },
  { id: 'status', header: t('stock.col.status'), cell: (a) => statusName(a.status) },
];

export default function StockAdjustmentsPage() {
  const mayCount = useMe().permissions.includes('stock:count');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listStockAdjustments, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('stock.adjustments.title')}</h1>
      <p>{t('stock.adjustments.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('stock.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('stock.all') }, ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: statusName(s) })),
        ]} />
        {mayCount ? <Link className="kit-button kit-button-primary" href="/stock/adjustments/new">{t('stock.adjustments.new')}</Link> : null}
      </div>
      <DataTable caption={t('stock.adjustments.title')} columns={columns} rowKey={(a) => a.id} list={list} empty={t('stock.adjustments.empty')} />
    </>
  );
}
