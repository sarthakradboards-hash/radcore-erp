'use client';
// Vehicle bookings (RAD-127 on RAD-117's contracts): newest first, a page at a time, filtered by status, or to the delivered ones
// whose checklist isn't complete. bookings:write writes a new one.
import { formatDate } from '@radcore/lib-common';
import { listBookings } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { numberText } from '../shared.tsx';
import { BOOKING_STATUSES, type BookingRow } from './shared.ts';

type Show = (typeof BOOKING_STATUSES)[number] | 'all' | 'checklist';

const columns: Column<BookingRow>[] = [
  { id: 'number', header: t('sales.number'), cell: (r) => <Link href={`/sales/bookings/${r.id}`}>{numberText(r.number)}</Link> },
  { id: 'party', header: t('sales.party'), cell: (r) => r.partyName },
  { id: 'model', header: t('sales.booking.col.model'), cell: (r) => `${r.name} (${r.sku})` },
  { id: 'unit', header: t('sales.booking.col.unit'), cell: (r) => r.serialNo },
  { id: 'date', header: t('sales.date'), cell: (r) => formatDate(r.businessDate) },
  { id: 'status', header: t('sales.status'), cell: (r) => t(`sales.booking.status.${r.status}`) },
];

export default function BookingsPage() {
  const mayWrite = useMe().permissions.includes('bookings:write');
  const [show, setShow] = useState<Show>('all');
  const filter = show === 'all' ? {} : show === 'checklist' ? { checklist: 'incomplete' as const } : { status: show };
  const list = useApiList(listBookings, { filter });
  return (
    <>
      <h1>{t('sales.bookings.title')}</h1>
      <p>{t('sales.bookings.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('sales.status')} value={show} onChange={setShow} options={[
          { value: 'all', label: t('sales.all') },
          ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`sales.booking.status.${s}`) })),
          { value: 'checklist', label: t('sales.bookings.checklist') },
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/bookings/new">{t('sales.bookings.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.bookings.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('sales.bookings.empty')} />
    </>
  );
}
