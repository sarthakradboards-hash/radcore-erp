'use client';
// Deliveries (RAD-125 on RAD-112's contracts): goods that went out against an order, newest first, a page at a time and
// filtered by status. There is no "new" here yet: a delivery's lines name the batches and serials the goods come from, and
// the form waits for the read of stock on hand by batch (RAD-112's follow-up). A draft is posted or deleted from its page.
import { formatDate } from '@radcore/lib-common';
import { listDeliveries } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText } from '../shared.tsx';
import { STATUSES, type DeliveryRow } from './shared.tsx';

type Show = (typeof STATUSES)[number] | 'all';

const columns: Column<DeliveryRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (d) => <Link href={`/sales/deliveries/${d.id}`}>{numberText(d.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (d) => d.partyName },
  { id: 'date', header: t('sales.date'), cell: (d) => formatDate(d.businessDate) },
  { id: 'status', header: t('sales.status'), cell: (d) => t(`sales.delivery.status.${d.status}`) },
];

export default function DeliveriesPage() {
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listDeliveries, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.deliveries.title')}</h1>
      <p>{t('sales.deliveries.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...STATUSES.map((s) => ({ value: s, label: t(`sales.delivery.status.${s}`) })),
        ]} />
      </div>
      <DataTable caption={t('sales.deliveries.title')} columns={columns} rowKey={(d) => d.id} list={list} empty={t('sales.deliveries.empty')} />
    </>
  );
}
