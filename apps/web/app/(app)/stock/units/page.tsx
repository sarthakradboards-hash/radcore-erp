'use client';
// Serialised units (RAD-144 on #394's listStockUnits): by serial, a page at a time. A search is a prefix of a serial or chassis
// number, as the server matches it; ownership and place narrow it. Each opens to its trail.
import { UNIT_OWNERSHIPS } from '@radcore/lib-common';
import { listStockUnits } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { usePlaces } from '../shared.tsx';

type Row = z.output<typeof listStockUnits.output>['items'][number];
type Whose = Row['ownership'] | 'all';
const columns: Column<Row>[] = [
  { id: 'serial', header: t('stock.units.serial'), cell: (r) => <Link href={`/stock/units/${r.id}`}>{r.serialNo}</Link> },
  { id: 'chassis', header: t('stock.units.chassis'), cell: (r) => r.chassisNo ?? '' },
  { id: 'item', header: t('stock.line.item'), cell: (r) => `${r.name} (${r.sku})` },
  { id: 'whose', header: t('stock.units.ownership'), cell: (r) => t(`stock.units.ownership.${r.ownership}`) },
  { id: 'place', header: t('stock.place'), cell: (r) => r.locationName ?? '' },
  { id: 'condition', header: t('stock.units.condition'), cell: (r) => t(`stock.adjustment.condition.${r.condition}`) },
  { id: 'batch', header: t('stock.line.batch'), cell: (r) => r.batchNo ?? '' },
  { id: 'promised', header: t('stock.units.promised'), cell: (r) => (r.promised ? t('stock.units.promised.yes') : '') },
];

export default function StockUnitsPage() {
  const [whose, setWhose] = useState<Whose>('ours');
  const [place, setPlace] = useState('');
  const [search, setSearch] = useState('');
  const places = usePlaces(place);
  const list = useApiList(listStockUnits, { filter: {
    ...(whose === 'all' ? {} : { ownership: whose }), ...(place === '' ? {} : { locationId: place }), ...(search === '' ? {} : { search }),
  } });
  return (
    <>
      <h1>{t('stock.units.title')}</h1>
      <p>{t('stock.units.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Whose> label={t('stock.units.ownership')} value={whose} onChange={setWhose} options={[
          ...UNIT_OWNERSHIPS.map((o) => ({ value: o, label: t(`stock.units.ownership.${o}`) })), { value: 'all', label: t('stock.all') },
        ]} />
        <label className="kit-field">
          <span>{t('stock.place')}</span>
          <select className="kit-select" value={place} onChange={(e) => setPlace(e.currentTarget.value)}>
            <option value="">{t('stock.onHand.everyPlace')}</option>
            {places.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <SearchBox label={t('stock.units.search')} action={t('stock.show')} maxLength={60} onSearch={setSearch} />
      </div>
      <DataTable caption={t('stock.units.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('stock.units.empty')} />
    </>
  );
}
