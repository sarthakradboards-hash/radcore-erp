'use client';
// The audit trail (RAD-57, M1-12, M1-13): two tabs, every saved change and the security events (sign-ins, password
// and second-factor changes, exports), each newest first, paged and filtered. Values arrive as the server sends them:
// personal data this person may not see is already masked, and secrets read "[redacted]"; the screen never unmasks.
// Filters apply on "Show", so typing doesn't fetch, and each tab keeps its own while the other is open.
import { addDays, dateString, formatMoment, indiaDate } from '@radcore/lib-common';
import { Tabs } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { Picker } from '../../../../components/ui/picker/picker.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import {
  listAuditedTables, listAuditTrail, listSecurityEvents, listUsers, type AdminUser, type AuditOp, type AuditRow,
  type SecurityEvent, type SecurityEventKind,
} from '../contracts.ts';
import { ChoiceButtons, MESSAGES } from '../shared.tsx';

const range = { from: dateString(), to: dateString() };
const ordered = <T extends { from: string; to: string }>(f: T) => f.from <= f.to;
const changeFilters = z.object({
  ...range,
  tableName: z.string().regex(/^([a-z][a-z0-9_]{0,62})?$/, t('audit.err.table')),
  recordId: z.string().max(64),
}).refine(ordered, { error: t('audit.err.range'), path: ['to'] });
const eventFilters = z.object(range).refine(ordered, { error: t('audit.err.range'), path: ['to'] });

/** The last 30 days in India, the default range. */
function useLastMonth() {
  const [today] = useState(() => indiaDate(new Date()));
  return { from: addDays(today, -30), to: today };
}

type Principal = AuditRow['principal'];
const who = (p: Principal | null) => (p === null ? t('audit.unknown') : p.kind === 'system' ? t('audit.system', { name: p.id.replace(/^system:/, '') })
  : p.kind === 'link' ? t('audit.link', { id: p.id }) : p.displayName ?? t('audit.unknown'));

const show = (v: unknown) => (v === undefined ? t('audit.none') : typeof v === 'string' ? v : JSON.stringify(v));

function Pairs({ pairs }: { pairs: readonly (readonly [string, string])[] }) {
  return (
    <dl className="admin-changes">
      {pairs.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

const changeColumns: Column<AuditRow>[] = [
  { id: 'when', header: t('audit.col.when'), cell: (r) => formatMoment(r.occurredAt) },
  { id: 'who', header: t('audit.col.who'), cell: (r) => who(r.principal) },
  { id: 'what', header: t('audit.col.what'), cell: (r) => `${r.tableName} ${r.recordId}` },
  { id: 'op', header: t('audit.col.op'), cell: (r) => t(`audit.op.${r.op}`) },
  { id: 'changes', header: t('audit.col.changes'), cell: (r) => <Pairs pairs={Object.entries(r.changed).map(
    ([column, { old: before, new: after }]) => [column,
      r.op === 'update' ? `${show(before)} → ${show(after)}` : show(r.op === 'insert' ? after : before)] as const)} /> },
];

const eventColumns: Column<SecurityEvent>[] = [
  { id: 'when', header: t('audit.col.when'), cell: (e) => formatMoment(e.occurredAt) },
  { id: 'who', header: t('audit.col.who'), cell: (e) => who(e.principal) },
  { id: 'kind', header: t('events.col.kind'), cell: (e) => t(`events.kind.${e.kind}`) },
  { id: 'device', header: t('sessions.col.device'), cell: (e) => e.device },
  { id: 'detail', header: t('events.col.detail'),
    cell: (e) => <Pairs pairs={Object.entries(e.detail).map(([k, v]) => [k, show(v)] as const)} /> },
];

/** The "changed by" filter: the kit's Picker over the people list, and a way back to everyone. */
function PersonFilter({ person, onChange }: { person: AdminUser | null; onChange: (p: AdminUser | null) => void }) {
  const [query, setQuery] = useState('');
  const found = useApiSearch(listUsers, query);
  return (
    <>
      <Picker label={t('audit.who')} query={query} onQueryChange={setQuery} options={found.items}
        loading={found.isFetching} error={found.error} value={person} onChange={onChange}
        optionKey={(u) => u.id} optionLabel={(u) => u.displayName} optionDetail={(u) => u.email} />
      {person === null ? null : <button type="button" className="kit-button" onClick={() => onChange(null)}>{t('sessions.clear')}</button>}
    </>
  );
}

/** A refusal the screen can word (range_too_long) is said in words in place of the table; anything else is the
 * table's own alert. */
function Refused({ error, children }: { error: Error | null; children: ReactNode }) {
  const said = error instanceof ApiError ? MESSAGES[error.code] : undefined;
  return said === undefined ? children : <p role="alert" className="kit-form-alert">{said}</p>;
}

function Filters({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="admin-toolbar">
      <h2 id={id} className="visually-hidden">{t('audit.filters')}</h2>
      {children}
    </section>
  );
}

function ChangesTab({ active }: { active: boolean }) {
  const month = useLastMonth();
  const [applied, setApplied] = useState({ ...month, tableName: '', recordId: '' });
  const [op, setOp] = useState<'all' | AuditOp>('all');
  const [person, setPerson] = useState<AdminUser | null>(null);
  const tables = useApiQuery(listAuditedTables, {}, { enabled: active }).data?.tables ?? [];
  const list = useApiList(listAuditTrail, { filter: {
    occurred: { from: applied.from, to: applied.to },
    ...(applied.tableName === '' ? {} : { tableName: applied.tableName }),
    ...(applied.recordId.trim() === '' ? {} : { recordId: applied.recordId.trim() }),
    ...(person === null ? {} : { principal: person.id }),
    ...(op === 'all' ? {} : { op }),
  } }, { enabled: active });
  return (
    <>
      <Filters id="changes-filters">
        <Form aria-labelledby="changes-filters" schema={changeFilters} defaultValues={applied} saved={false}
          onSubmit={async (f) => { setApplied(f); }}>
          <div className="admin-filters">
            <TextField name="from" label={t('audit.from')} type="date" />
            <TextField name="to" label={t('audit.to')} type="date" />
            <TextField name="tableName" label={t('audit.table')} hint={t('audit.table.hint')} list="audit-tables" autoComplete="off" />
            <TextField name="recordId" label={t('audit.record')} autoComplete="off" />
          </div>
          <datalist id="audit-tables">{tables.map((name) => <option key={name} value={name} />)}</datalist>
          <SubmitButton>{t('audit.apply')}</SubmitButton>
        </Form>
        <PersonFilter person={person} onChange={setPerson} />
        <ChoiceButtons<'all' | AuditOp> label={t('audit.op')} value={op} onChange={setOp} options={[
          { value: 'all', label: t('audit.op.all') }, { value: 'insert', label: t('audit.op.insert') },
          { value: 'update', label: t('audit.op.update') }, { value: 'delete', label: t('audit.op.delete') },
        ]} />
      </Filters>
      <Refused error={list.error}>
        <DataTable caption={t('audit.caption')} columns={changeColumns} rowKey={(r) => r.id} list={list} empty={t('audit.empty')} />
      </Refused>
    </>
  );
}

const KINDS: readonly SecurityEventKind[] = ['sign_in', 'sign_in_failed', 'password_changed', 'second_factor_changed', 'export', 'download'];

function EventsTab({ active }: { active: boolean }) {
  const month = useLastMonth();
  const [applied, setApplied] = useState(month);
  const [kind, setKind] = useState<'all' | SecurityEventKind>('all');
  const [person, setPerson] = useState<AdminUser | null>(null);
  const list = useApiList(listSecurityEvents, { filter: {
    occurred: applied,
    ...(person === null ? {} : { principal: person.id }),
    ...(kind === 'all' ? {} : { kind }),
  } }, { enabled: active });
  return (
    <>
      <Filters id="events-filters">
        <Form aria-labelledby="events-filters" schema={eventFilters} defaultValues={applied} saved={false}
          onSubmit={async (f) => { setApplied(f); }}>
          <div className="admin-filters">
            <TextField name="from" label={t('audit.from')} type="date" />
            <TextField name="to" label={t('audit.to')} type="date" />
          </div>
          <SubmitButton>{t('audit.apply')}</SubmitButton>
        </Form>
        <PersonFilter person={person} onChange={setPerson} />
        <ChoiceButtons<'all' | SecurityEventKind> label={t('events.col.kind')} value={kind} onChange={setKind}
          options={[{ value: 'all', label: t('audit.op.all') }, ...KINDS.map((k) => ({ value: k, label: t(`events.kind.${k}`) }))]} />
      </Filters>
      <Refused error={list.error}>
        <DataTable caption={t('events.caption')} columns={eventColumns} rowKey={(e) => e.id} list={list} empty={t('audit.empty')} />
      </Refused>
    </>
  );
}

export default function AuditPage() {
  const [tab, setTab] = useState('changes');
  return (
    <>
      <h1>{t('audit.title')}</h1>
      <p>{t('audit.intro')}</p>
      <Tabs.Root value={tab} onValueChange={setTab} className="admin-tabs">
        <Tabs.List aria-label={t('audit.title')} className="kit-actions admin-choices">
          <Tabs.Trigger value="changes" className="kit-button">{t('audit.tab.changes')}</Tabs.Trigger>
          <Tabs.Trigger value="events" className="kit-button">{t('audit.tab.events')}</Tabs.Trigger>
        </Tabs.List>
        {/* Both stay mounted, so each keeps its filters; only the open one fetches. */}
        <Tabs.Content value="changes" forceMount hidden={tab !== 'changes'}><ChangesTab active={tab === 'changes'} /></Tabs.Content>
        <Tabs.Content value="events" forceMount hidden={tab !== 'events'}><EventsTab active={tab === 'events'} /></Tabs.Content>
      </Tabs.Root>
    </>
  );
}
