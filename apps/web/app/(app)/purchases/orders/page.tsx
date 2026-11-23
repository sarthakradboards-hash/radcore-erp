'use client';
// Purchase orders (RAD-143 on RAD-136's contracts): newest first, a page at a time, filtered by status. purchasing:write
// starts a new one; its page places, changes, closes or cancels it.
import { formatDate, formatMoney, PURCHASE_ORDER_STATUSES } from '@radcore/lib-common';
import { listPurchaseOrders } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, statusName } from '../shared.tsx';

type Row = z.output<typeof listPurchaseOrders.output>['items'][number];
type Show = (typeof PURCHASE_ORDER_STATUSES)[number] | 'all';

const columns: Column<Row>[] = [
  { id: 'number', header: t('purchases.col.number'), cell: (o) => <Link href={`/purchases/orders/${o.id}`}>{numberText(o.number)}</Link> },
  { id: 'supplier', header: t('purchases.col.supplier'), cell: (o) => o.supplierName },
  { id: 'date', header: t('purchases.col.date'), cell: (o) => formatDate(o.businessDate) },
  { id: 'expectedBy', header: t('purchases.col.expectedBy'), cell: (o) => (o.expectedBy === null ? '' : formatDate(o.expectedBy)) },
  { id: 'total', header: t('purchases.col.total'), numeric: true, cell: (o) => (o.total === null ? t('purchases.col.total.draft') : formatMoney(o.total)) },
  { id: 'status', header: t('purchases.col.status'),
    cell: (o) => (o.awaitingApproval ? t('purchases.status.awaiting') : statusName(o.status)) },
];

export default function PurchaseOrdersPage() {
  const mayWrite = useMe().permissions.includes('purchasing:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listPurchaseOrders, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('purchases.orders.title')}</h1>
      <p>{t('purchases.orders.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('purchases.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('purchases.all') }, ...PURCHASE_ORDER_STATUSES.map((s) => ({ value: s, label: statusName(s) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/purchases/orders/new">{t('purchases.orders.new')}</Link> : null}
      </div>
      <DataTable caption={t('purchases.orders.title')} columns={columns} rowKey={(o) => o.id} list={list} empty={t('purchases.orders.empty')} />
    </>
  );
}
