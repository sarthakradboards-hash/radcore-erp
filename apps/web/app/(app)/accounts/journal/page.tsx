'use client';
// The journal (RAD-100 on RAD-86's routes): every entry a page at a time, newest business date first, then number. A
// date range applies on "Show"; manual journals can be shown alone. journal:post adds a manual journal.
import { formatDate, formatMoney } from '@radcore/lib-common';
import { listJournal } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { kindText, postedBy, type Entry } from '../shared.tsx';

// Empty boxes mean no bound; a range must run forwards.
const day = z.string().trim().refine((s) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s), t('books.journal.err.date'));
const filters = z.object({ from: day, to: day })
  .refine((f) => f.from === '' || f.to === '' || f.from <= f.to, { error: t('books.journal.err.range'), path: ['to'] });

const columns: Column<Entry>[] = [
  { id: 'number', header: t('books.journal.number'), cell: (e) => <Link href={`/accounts/journal/${e.id}`}>{e.number}</Link> },
  { id: 'date', header: t('books.journal.date'), cell: (e) => formatDate(e.businessDate) },
  { id: 'kind', header: t('books.journal.kind'), cell: (e) => kindText(e.kind) },
  { id: 'total', header: t('books.journal.total'), numeric: true, cell: (e) => formatMoney(e.total) },
  { id: 'status', header: t('books.journal.status'), cell: (e) => t(e.reversedBy !== null ? 'books.journal.reversed'
    : e.reversesEntryId !== null ? 'books.journal.reversal' : 'books.journal.standing') },
  { id: 'who', header: t('books.journal.who'), cell: (e) => postedBy(e.postedBy) },
];

type Kind = 'all' | 'manual';

export default function JournalPage() {
  const mayPost = useMe().permissions.includes('journal:post');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [kind, setKind] = useState<Kind>('all');
  const list = useApiList(listJournal, { filter: {
    ...(applied.from === '' ? {} : { from: applied.from }),
    ...(applied.to === '' ? {} : { to: applied.to }),
    ...(kind === 'all' ? {} : { kind }),
  } });
  return (
    <>
      <h1>{t('books.journal.title')}</h1>
      <p>{t('books.journal.intro')}</p>
      <section aria-labelledby="journal-filters" className="admin-toolbar">
        <h2 id="journal-filters" className="visually-hidden">{t('books.journal.filters')}</h2>
        <Form aria-labelledby="journal-filters" schema={filters} defaultValues={applied} saved={false}
          onSubmit={async (f) => { setApplied(f); }}>
          <div className="admin-filters">
            <TextField name="from" label={t('books.journal.from')} type="date" />
            <TextField name="to" label={t('books.journal.to')} type="date" />
          </div>
          <SubmitButton>{t('books.journal.show')}</SubmitButton>
        </Form>
        <ChoiceButtons<Kind> label={t('books.journal.kind')} value={kind} onChange={setKind} options={[
          { value: 'all', label: t('books.journal.all') }, { value: 'manual', label: t('books.kind.manual') },
        ]} />
        {mayPost ? <Link className="kit-button kit-button-primary" href="/accounts/journal/new">{t('books.new.title')}</Link> : null}
      </section>
      <DataTable caption={t('books.journal.title')} columns={columns} rowKey={(e) => e.id} list={list} empty={t('books.journal.empty')} />
    </>
  );
}
