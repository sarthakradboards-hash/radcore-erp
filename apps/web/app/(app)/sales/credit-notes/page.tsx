'use client';
// Credit notes (RAD-125 on RAD-114's contract): what was credited against posted invoices, newest first, a page at a time and
// filtered by status. credit_notes:write writes a new one; someone else approves it, which posts it.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listCreditNotes } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText } from '../shared.tsx';
import { CREDIT_STATUSES, type CreditRow } from './shared.tsx';

type Show = (typeof CREDIT_STATUSES)[number] | 'all';

const columns: Column<CreditRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (c) => <Link href={`/sales/credit-notes/${c.id}`}>{numberText(c.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (c) => c.partyName },
  { id: 'date', header: t('sales.date'), cell: (c) => formatDate(c.businessDate) },
  { id: 'kind', header: t('sales.credit.col.kind'), cell: (c) => t(`sales.credit.kind.${c.kind}`) },
  { id: 'total', header: t('sales.credit.col.total'), numeric: true, cell: (c) => formatMoney(c.total) },
  { id: 'status', header: t('sales.status'), cell: (c) => t(`sales.credit.status.${c.status}`) },
];

export default function CreditNotesPage() {
  const mayWrite = useMe().permissions.includes('credit_notes:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listCreditNotes, { filter: show === 'all' ? {} : { status: show } });
  return (
    <>
      <h1>{t('sales.credits.title')}</h1>
      <p>{t('sales.credits.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...CREDIT_STATUSES.map((s) => ({ value: s, label: t(`sales.credit.status.${s}`) })),
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/credit-notes/new">{t('sales.credits.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.credits.title')} columns={columns} rowKey={(c) => c.id} list={list} empty={t('sales.credits.empty')} />
    </>
  );
}
