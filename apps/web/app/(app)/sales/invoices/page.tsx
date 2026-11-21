'use client';
// Invoices (RAD-125 on RAD-113's contracts): what has been billed, newest first, a page at a time and filtered by status.
// invoices:write starts a new one; its page posts it, or cancels a posted one.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listInvoices } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText } from '../shared.tsx';
import { INVOICE_STATUSES, type InvoiceRow } from './shared.ts';

type Show = (typeof INVOICE_STATUSES)[number] | 'all';

const columns: Column<InvoiceRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (i) => <Link href={`/sales/invoices/${i.id}`}>{numberText(i.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (i) => i.partyName },
  { id: 'date', header: t('sales.date'), cell: (i) => formatDate(i.businessDate) },
  { id: 'total', header: t('sales.invoice.col.total'), numeric: true, cell: (i) => formatMoney(i.total) },
  { id: 'status', header: t('sales.status'), cell: (i) => t(`sales.invoice.status.${i.status}`) },
];

export default function InvoicesPage() {
  const mayWrite = useMe().permissions.includes('invoices:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listInvoices, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.invoices.title')}</h1>
      <p>{t('sales.invoices.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...INVOICE_STATUSES.map((s) => ({ value: s, label: t(`sales.invoice.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/invoices/new">{t('sales.invoices.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.invoices.title')} columns={columns} rowKey={(i) => i.id} list={list} empty={t('sales.invoices.empty')} />
    </>
  );
}
