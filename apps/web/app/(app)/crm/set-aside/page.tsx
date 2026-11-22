'use client';
// Set aside (RAD-122 on RAD-110's contracts): the enquiries an ignored source kept without making them leads, newest
// first, so nothing disappears unseen (RC-212). Read-only, under leads:setup. Every phone is the server's last-4 mask,
// as on every lead list (RC-041), and a message is what the outsider wrote, shown as text (RC-173).
import { formatMoment } from '@radcore/lib-common';
import { listLeadSources, listSetAside } from '@radcore/lib-crm/contract';
import { useState } from 'react';
import type { z } from 'zod';
import { Pii } from '../../../../components/ui/masked.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';

type Row = z.output<typeof listSetAside.output>['items'][number];

export default function SetAsidePage() {
  const sources = useApiQuery(listLeadSources, {}).data?.sources ?? [];
  const [sourceId, setSourceId] = useState('');
  const list = useApiList(listSetAside, { filter: sourceId === '' ? {} : { sourceId } });
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? '';
  const columns: Column<Row>[] = [
    { id: 'received', header: t('crm.setAside.col.received'), cell: (r) => formatMoment(r.receivedAt) },
    { id: 'source', header: t('crm.setAside.col.source'), cell: (r) => sourceName(r.sourceId) },
    { id: 'name', header: t('crm.setAside.col.name'), cell: (r) => r.name ?? '' },
    { id: 'phone', header: t('crm.setAside.col.phone'), cell: (r) => <Pii value={r.phone} /> },
    { id: 'message', header: t('crm.setAside.col.message'), cell: (r) => <span className="crm-message">{r.message ?? ''}</span> },
  ];
  return (
    <>
      <h1>{t('crm.setAside.title')}</h1>
      <p>{t('crm.setAside.intro')}</p>
      <div className="admin-toolbar">
        {/* Choosing a source only filters the list (RC-148). */}
        <label className="kit-field">
          <span>{t('crm.setAside.source')}</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">{t('crm.setAside.allSources')}</option>
            {sources.filter((s) => s.door).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <DataTable caption={t('crm.setAside.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('crm.setAside.empty')} />
    </>
  );
}
