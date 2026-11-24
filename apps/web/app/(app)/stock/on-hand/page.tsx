'use client';
// Stock on hand (RAD-144 on #394's listStockOnHand): a row per item and place holding any, by SKU then place, a page at a time.
// A position's value is kept by item and place, not by batch (ADR-006 §4a), so each row shows its value once and its batches'
// quantities; the value is cost(), masked without cost:read. Filtered by place and by an item's SKU or name, as the server does.
import { listStockOnHand } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import type { z } from 'zod';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { usePlaces, Value } from '../shared.tsx';

type Row = z.output<typeof listStockOnHand.output>['items'][number];
const columns: Column<Row>[] = [
  { id: 'item', header: t('stock.line.item'), cell: (r) => `${r.name} (${r.sku})` },
  { id: 'place', header: t('stock.place'), cell: (r) => r.locationName },
  { id: 'qty', header: t('stock.onHand.qty'), numeric: true, cell: (r) => `${asWritten(r.qty)} ${r.unit}` },
  { id: 'batches', header: t('stock.line.batch'), cell: (r) => r.batches.map((b) => `${b.batchNo ?? t('stock.batch.none')} (${asWritten(b.qty)})`).join(', ') },
  { id: 'value', header: t('stock.line.value'), numeric: true, cell: (r) => <Value x={r.value} /> },
];

export default function StockOnHandPage() {
  const [place, setPlace] = useState('');
  const [search, setSearch] = useState('');
  const places = usePlaces(place);
  const list = useApiList(listStockOnHand, { filter: { ...(place === '' ? {} : { locationId: place }), ...(search === '' ? {} : { search }) } });
  return (
    <>
      <h1>{t('stock.onHand.title')}</h1>
      <p>{t('stock.onHand.intro')}</p>
      <div className="admin-toolbar">
        <label className="kit-field">
          <span>{t('stock.place')}</span>
          <select className="kit-select" value={place} onChange={(e) => setPlace(e.currentTarget.value)}>
            <option value="">{t('stock.onHand.everyPlace')}</option>
            {places.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <SearchBox label={t('stock.onHand.search')} action={t('stock.show')} onSearch={setSearch} />
      </div>
      <DataTable caption={t('stock.onHand.title')} columns={columns} rowKey={(r) => `${r.itemId}:${r.locationId}`} list={list} empty={t('stock.onHand.empty')} />
    </>
  );
}
