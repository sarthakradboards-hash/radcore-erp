'use client';
// Goods receipts (RAD-143 on RAD-137's contracts): arrivals against placed purchase orders, newest first, a page at a time and
// filtered by status. inward:write records an arrival; inward:qc does QC and posting from the receipt's page.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listGoodsReceipts } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { RECEIPT_STATUSES, receiptNumber, type ReceiptRow } from './shared.tsx';

type Show = (typeof RECEIPT_STATUSES)[number] | 'all';

const columns: Column<ReceiptRow>[] = [
  { id: 'number', header: t('inward.col.number'), cell: (r) => <Link href={`/purchases/receipts/${r.id}`}>{receiptNumber(r.number)}</Link> },
  { id: 'order', header: t('inward.col.order'), cell: (r) => r.orderNumber ?? '' },
  { id: 'supplier', header: t('inward.col.supplier'), cell: (r) => r.supplierName },
  { id: 'date', header: t('inward.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'value', header: t('inward.col.value'), cell: (r) => (r.value === null ? '' : formatMoney(r.value)) },
  { id: 'status', header: t('inward.col.status'), cell: (r) => t(`inward.status.${r.status}`) },
];

export default function ReceiptsPage() {
  const mayWrite = useMe().permissions.includes('inward:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listGoodsReceipts, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('inward.title')}</h1>
      <p>{t('inward.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('inward.col.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...RECEIPT_STATUSES.map((s) => ({ value: s, label: t(`inward.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/purchases/receipts/new">{t('inward.new')}</Link> : null}
      </div>
      <DataTable caption={t('inward.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('inward.empty')} />
    </>
  );
}
