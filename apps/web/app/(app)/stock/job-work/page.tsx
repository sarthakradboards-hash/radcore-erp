'use client';
// Job work challans (RAD-144 on RAD-142's contracts, ADR-008 §11): newest first, a page at a time. The open ones are what
// the job workers still hold; past their return days, section 143 says tax may fall due, so they're a filter of their own.
// job_work:write sends goods out; receipts answer what was sent.
import { formatDate } from '@radcore/lib-common';
import { listJobWorkChallans } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { statusName } from '../shared.tsx';

type Row = z.output<typeof listJobWorkChallans.output>['items'][number];
type Show = 'all' | 'open' | 'late' | 'cancelled';
const columns: Column<Row>[] = [
  { id: 'number', header: t('stock.col.number'), cell: (r) => <Link href={`/stock/job-work/${r.id}`}>{r.number}</Link> },
  { id: 'from', header: t('stock.jobWork.from'), cell: (r) => r.fromName },
  { id: 'party', header: t('stock.jobWork.party'), cell: (r) => r.partyName },
  { id: 'date', header: t('stock.col.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'state', header: t('stock.col.status'), cell: (r) => (r.status === 'cancelled' ? statusName('cancelled')
    : !r.open ? t('stock.jobWork.closed') : r.pastReturnDays ? t('stock.jobWork.late', { days: String(r.ageDays) })
      : t('stock.jobWork.openFor', { days: String(r.ageDays) })) },
];
const FILTERS: Record<Show, z.input<typeof listJobWorkChallans.input>['filter']> = {
  all: {}, open: { status: 'posted', open: true }, late: { status: 'posted', pastReturnDays: true }, cancelled: { status: 'cancelled' },
};

export default function JobWorkChallansPage() {
  const mayWrite = useMe().permissions.includes('job_work:write');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listJobWorkChallans, { filter: FILTERS[show] });
  return (
    <>
      <h1>{t('stock.jobWork.title')}</h1>
      <p>{t('stock.jobWork.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('stock.status')} value={show} onChange={setShow} options={(['all', 'open', 'late', 'cancelled'] as const)
          .map((s) => ({ value: s, label: t(`stock.jobWork.show.${s}`) }))} />
        <Link className="kit-button" href="/stock/job-work/receipts">{t('stock.jobWork.receipts')}</Link>
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/stock/job-work/new">{t('stock.jobWork.new')}</Link> : null}
      </div>
      <DataTable caption={t('stock.jobWork.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('stock.jobWork.empty')} />
    </>
  );
}
