'use client';
// Delivery returns (RAD-125 on RAD-112's contracts): goods that came back from a customer before they were invoiced, newest
// first, a page at a time and filtered by status. A draft is posted or deleted from its page; its form waits, like a
// delivery's, for the read of stock by batch.
import { formatDate } from '@radcore/lib-common';
import { listDeliveryReturns } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { STATUSES, type ReturnRow } from '../deliveries/shared.tsx';
import { numberText } from '../shared.tsx';

type Show = (typeof STATUSES)[number] | 'all';

const columns: Column<ReturnRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (r) => <Link href={`/sales/delivery-returns/${r.id}`}>{numberText(r.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (r) => r.partyName },
  { id: 'date', header: t('sales.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('sales.status'), cell: (r) => t(`sales.return.status.${r.status}`) },
];

export default function DeliveryReturnsPage() {
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listDeliveryReturns, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.returns.title')}</h1>
      <p>{t('sales.returns.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...STATUSES.map((s) => ({ value: s, label: t(`sales.return.status.${s}`) })),
        ]} />
      </div>
      <DataTable caption={t('sales.returns.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('sales.returns.empty')} />
    </>
  );
}
