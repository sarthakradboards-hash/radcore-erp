'use client';
// Sessions (RAD-57, M1-16): every live session, or one person's, and ending one. Your own current session is ended
// by signing out, so it has no End button (the server refuses it as current_session anyway).
import { endSession, listSessions, listUsers } from '@radcore/lib-platform/contract';
import { formatMoment } from '@radcore/lib-common';
import { useState } from 'react';
import { Picker } from '../../../../components/ui/picker/picker.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../shared.tsx';
import type { AdminSession, AdminUser } from '../types.ts';

/** A session ends at whichever comes first: idle time running out, or its absolute limit. */
const endsBy = (s: AdminSession) => (Date.parse(s.idleExpiresAt) < Date.parse(s.absoluteExpiresAt) ? s.idleExpiresAt : s.absoluteExpiresAt);

export default function SessionsPage() {
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<AdminUser | null>(null);
  const found = useApiSearch(listUsers, query);
  const list = useApiList(listSessions, { filter: person === null ? {} : { userId: person.id } });
  const end = useApiMutation(endSession, { invalidates: [listSessions] });
  const [ending, setEnding] = useState<AdminSession | null>(null);

  const columns: Column<AdminSession>[] = [
    { id: 'person', header: t('sessions.col.person'), cell: (s) => s.user.displayName },
    { id: 'device', header: t('sessions.col.device'), cell: (s) => s.device },
    { id: 'started', header: t('sessions.col.started'), cell: (s) => formatMoment(s.createdAt) },
    { id: 'seen', header: t('sessions.col.seen'), cell: (s) => formatMoment(s.lastSeenAt) },
    { id: 'ends', header: t('sessions.col.ends'), cell: (s) => formatMoment(endsBy(s)) },
    { id: 'action', header: t('sessions.col.action'), cell: (s) => (s.current ? t('sessions.current') : (
      <button type="button" className="kit-button" onClick={() => setEnding(s)}
        aria-label={t('sessions.end.label', { name: s.user.displayName, device: s.device })}>{t('sessions.end')}</button>
    )) },
  ];

  const vars = { name: ending?.user.displayName ?? '', device: ending?.device ?? '' };
  return (
    <>
      <h1>{t('sessions.title')}</h1>
      <div className="admin-toolbar">
        <Picker label={t('sessions.person')} hint={t('sessions.person.hint')} query={query} onQueryChange={setQuery}
          options={found.items} loading={found.isFetching} error={found.error} value={person} onChange={setPerson}
          optionKey={(u) => u.id} optionLabel={(u) => u.displayName} optionDetail={(u) => u.email} />
        {person === null ? null : (
          <button type="button" className="kit-button" onClick={() => setPerson(null)}>{t('sessions.clear')}</button>
        )}
      </div>
      <DataTable caption={t('sessions.title')} columns={columns} rowKey={(s) => s.id} list={list} empty={t('sessions.empty')} />
      <ConfirmDialog open={ending !== null} onOpenChange={(open) => { if (!open) setEnding(null); }}
        title={t('sessions.end.title', vars)} body={t('sessions.end.body')} action={t('sessions.end')}
        done={t('sessions.end.done')} onConfirm={async () => { await end.submit({ id: ending?.id ?? '' }); }} />
    </>
  );
}
