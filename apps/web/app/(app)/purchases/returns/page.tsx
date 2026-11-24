'use client';
// Supplier returns (RAD-143 on RAD-140's contracts): rejects sent back to their suppliers, newest first, with the debit note each
// one raised against what was billed.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listSupplierReturns } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';

type Row = z.output<typeof listSupplierReturns.output>['items'][number];
type Show = Row['status'] | 'all';
const statusName = (s: Row['status']) => t(`purchases.bill.status.${s}`);
const columns: Column<Row>[] = [
  { id: 'number', header: t('purchases.col.number'), cell: (r) => <Link href={`/purchases/returns/${r.id}`}>{r.number ?? t('purchases.bill.status.draft')}</Link> },
  { id: 'supplier', header: t('purchases.order.supplier'), cell: (r) => r.supplierName },
  { id: 'place', header: t('purchases.return.place'), cell: (r) => r.locationName },
  { id: 'date', header: t('purchases.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('purchases.col.status'), cell: (r) => statusName(r.status) },
  { id: 'debit', header: t('purchases.return.debitNote'), cell: (r) => (r.debitNoteNumber === null ? '' : r.debitNoteNumber) },
  { id: 'total', header: t('purchases.return.debitTotal'), numeric: true, cell: (r) => (r.debitTotal === null ? '' : formatMoney(r.debitTotal)) },
];

export default function SupplierReturnsPage() {
  const mayWrite = useMe().permissions.includes('supplier_returns:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listSupplierReturns, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('purchases.returns.title')}</h1>
      <p>{t('purchases.returns.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('purchases.col.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('purchases.bill.all') }, ...(['draft', 'posted', 'cancelled'] as const).map((s) => ({ value: s, label: statusName(s) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/purchases/returns/new">{t('purchases.return.new')}</Link> : null}
      </div>
      <DataTable caption={t('purchases.returns.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('purchases.returns.empty')} />
    </>
  );
}
