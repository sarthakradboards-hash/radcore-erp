'use client';
// Job work receipts (RAD-144 on RAD-142's contracts): newest first, a page at a time. A receipt is made from its challan's page.
import { formatDate } from '@radcore/lib-common';
import { listJobWorkReceipts } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../../admin/shared.tsx';
import { statusName } from '../../shared.tsx';

type Row = z.output<typeof listJobWorkReceipts.output>['items'][number];
type Show = 'all' | 'posted' | 'cancelled';
const columns: Column<Row>[] = [
  { id: 'number', header: t('stock.col.number'), cell: (r) => <Link href={`/stock/job-work/receipts/${r.id}`}>{r.number}</Link> },
  { id: 'challan', header: t('stock.jobWork.receipt.challan'), cell: (r) => <Link href={`/stock/job-work/${r.challanId}`}>{r.challanNumber}</Link> },
  { id: 'party', header: t('stock.jobWork.party'), cell: (r) => r.partyName },
  { id: 'to', header: t('stock.jobWork.receipt.to'), cell: (r) => r.locationName },
  { id: 'date', header: t('stock.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('stock.col.status'), cell: (r) => statusName(r.status) },
];

export default function JobWorkReceiptsPage() {
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listJobWorkReceipts, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <p><Link href="/stock/job-work">{t('stock.jobWork.back')}</Link></p>
      <h1>{t('stock.jobWork.receipts')}</h1>
      <p>{t('stock.jobWork.receipts.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('stock.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('stock.all') }, ...(['posted', 'cancelled'] as const).map((s) => ({ value: s, label: statusName(s) })),
        ]} />
      </div>
      <DataTable caption={t('stock.jobWork.receipts')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('stock.jobWork.receipts.empty')} />
    </>
  );
}
