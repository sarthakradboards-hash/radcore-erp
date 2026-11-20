'use client';
// Orders (RAD-125 on RAD-112's contracts): what customers have ordered, newest first, a page at a time and filtered by
// status. sales:write starts a new one; its page confirms it, closes it, or cancels it.
import { formatDate, SALES_ORDER_STATUSES } from '@radcore/lib-common';
import { listOrders } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText, type OrderRow } from '../shared.tsx';

type Show = (typeof SALES_ORDER_STATUSES)[number] | 'all';

const columns: Column<OrderRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (o) => <Link href={`/sales/orders/${o.id}`}>{numberText(o.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (o) => o.partyName },
  { id: 'date', header: t('sales.date'), cell: (o) => formatDate(o.businessDate) },
  { id: 'status', header: t('sales.status'), cell: (o) => t(`sales.order.status.${o.status}`) },
];

export default function OrdersPage() {
  const mayWrite = useMe().permissions.includes('sales:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listOrders, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.orders.title')}</h1>
      <p>{t('sales.orders.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...SALES_ORDER_STATUSES.map((s) => ({ value: s, label: t(`sales.order.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/orders/new">{t('sales.orders.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.orders.title')} columns={columns} rowKey={(o) => o.id} list={list} empty={t('sales.orders.empty')} />
    </>
  );
}
