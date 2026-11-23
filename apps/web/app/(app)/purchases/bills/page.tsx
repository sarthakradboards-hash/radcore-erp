'use client';
// Purchase bills (RAD-143 on RAD-138's contracts): newest first, a page at a time, filtered by status. A bill is the supplier's own
// invoice as entered here: its number and date are the supplier's, ours comes when it posts.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listPurchaseBills } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { billStatusName, billNumberText } from './bill-shared.tsx';

type Row = z.output<typeof listPurchaseBills.output>['items'][number];
type Show = Row['status'] | 'all';
const columns: Column<Row>[] = [
  { id: 'number', header: t('purchases.bill.col.number'), cell: (r) => <Link href={`/purchases/bills/${r.id}`}>{billNumberText(r.number)}</Link> },
  { id: 'supplier', header: t('purchases.order.supplier'), cell: (r) => r.supplierName },
  { id: 'invoice', header: t('purchases.bill.supplierInvoice'), cell: (r) => `${r.supplierInvoiceNumber}, ${formatDate(r.supplierInvoiceDate)}` },
  { id: 'date', header: t('purchases.bill.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('purchases.col.status'), cell: (r) => (r.awaitingApproval ? t('purchases.bill.awaitingShort') : billStatusName(r.status)) },
  { id: 'total', header: t('purchases.col.total'), numeric: true, cell: (r) => (r.total === null ? t('purchases.bill.totalPending') : formatMoney(r.total)) },
];

export default function PurchaseBillsPage() {
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listPurchaseBills, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('purchases.bills.title')}</h1>
      <p>{t('purchases.bills.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('purchases.col.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('purchases.bill.all') }, ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: billStatusName(s) })),
        ]} />
      </div>
      <DataTable caption={t('purchases.bills.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('purchases.bills.empty')} />
    </>
  );
}
