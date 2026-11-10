'use client';
// The audit trail (RAD-57, M1-12): every saved change, newest first, paged and filtered. Values arrive as the server
// sends them: personal data this person may not see is already masked, and secrets read "[redacted]"; the screen
// never unmasks. Filters apply on "Show", so typing doesn't fetch.
import { addDays, dateString, formatMoment, indiaDate } from '@radcore/lib-common';
import { useState } from 'react';
import { z } from 'zod';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { Picker } from '../../../../components/ui/picker/picker.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import {
  listAuditedTables, listAuditTrail, listUsers, type AdminUser, type AuditOp, type AuditRow,
} from '../contracts.ts';
import { ChoiceButtons, MESSAGES } from '../shared.tsx';

const filters = z.object({
  from: dateString(), to: dateString(),
  tableName: z.string().regex(/^([a-z][a-z0-9_]{0,62})?$/, t('audit.err.table')),
  recordId: z.string().max(64),
}).refine((f) => f.from <= f.to, { error: t('audit.err.range'), path: ['to'] });
type Filters = z.output<typeof filters>;

const show = (v: unknown) => (v === undefined ? t('audit.none') : typeof v === 'string' ? v : JSON.stringify(v));

function Changes({ row }: { row: AuditRow }) {
  return (
    <dl className="admin-changes">
      {Object.entries(row.changed).map(([column, { old: before, new: after }]) => (
        <div key={column}>
          <dt>{column}</dt>
          <dd>{row.op === 'update' ? `${show(before)} → ${show(after)}` : show(row.op === 'insert' ? after : before)}</dd>
        </div>
      ))}
    </dl>
  );
}

const who = ({ principal: p }: AuditRow) => (p.kind === 'system' ? t('audit.system', { name: p.id })
  : p.kind === 'link' ? t('audit.link', { id: p.id }) : p.displayName ?? t('audit.unknown'));

const columns: Column<AuditRow>[] = [
  { id: 'when', header: t('audit.col.when'), cell: (r) => formatMoment(r.occurredAt) },
  { id: 'who', header: t('audit.col.who'), cell: who },
  { id: 'what', header: t('audit.col.what'), cell: (r) => `${r.tableName} ${r.recordId}` },
  { id: 'op', header: t('audit.col.op'), cell: (r) => t(`audit.op.${r.op}`) },
  { id: 'changes', header: t('audit.col.changes'), cell: (r) => <Changes row={r} /> },
];

export default function AuditPage() {
  const [today] = useState(() => indiaDate(new Date()));
  const [applied, setApplied] = useState<Filters>({ from: addDays(today, -30), to: today, tableName: '', recordId: '' });
  const [op, setOp] = useState<'all' | AuditOp>('all');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<AdminUser | null>(null);
  const found = useApiSearch(listUsers, query);
  const tables = useApiQuery(listAuditedTables, {}).data?.tables ?? [];

  const list = useApiList(listAuditTrail, { filter: {
    occurred: { from: applied.from, to: applied.to },
    ...(applied.tableName === '' ? {} : { tableName: applied.tableName }),
    ...(applied.recordId.trim() === '' ? {} : { recordId: applied.recordId.trim() }),
    ...(person === null ? {} : { principal: person.id }),
    ...(op === 'all' ? {} : { op }),
  } });
  // A refusal the screen can word (range_too_long) is said in words; anything else is the table's own alert.
  const refused = list.error instanceof ApiError ? MESSAGES[list.error.code] : undefined;

  return (
    <>
      <h1>{t('audit.title')}</h1>
      <p>{t('audit.intro')}</p>
      <section aria-labelledby="audit-filters" className="admin-toolbar">
        <h2 id="audit-filters" className="visually-hidden">{t('audit.filters')}</h2>
        <Form aria-labelledby="audit-filters" schema={filters} defaultValues={applied} saved={false}
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
        <Picker label={t('audit.who')} query={query} onQueryChange={setQuery} options={found.items}
          loading={found.isFetching} error={found.error} value={person} onChange={setPerson}
          optionKey={(u) => u.id} optionLabel={(u) => u.displayName} optionDetail={(u) => u.email} />
        {person === null ? null : (
          <button type="button" className="kit-button" onClick={() => setPerson(null)}>{t('sessions.clear')}</button>
        )}
        <ChoiceButtons<'all' | AuditOp> label={t('audit.op')} value={op} onChange={setOp} options={[
          { value: 'all', label: t('audit.op.all') }, { value: 'insert', label: t('audit.op.insert') },
          { value: 'update', label: t('audit.op.update') }, { value: 'delete', label: t('audit.op.delete') },
        ]} />
      </section>
      {refused === undefined ? null : <p role="alert" className="kit-form-alert">{refused}</p>}
      <DataTable caption={t('audit.caption')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('audit.empty')} />
    </>
  );
}
