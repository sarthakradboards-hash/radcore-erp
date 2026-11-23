'use client';
// A customer's reminders (RAD-126 on RAD-119's routes): the ones recorded, latest first, each with what was owed then and who made
// it, and for receivables:remind a way to record another. Recording says how the customer was reminded; the server answers with the
// words to send (their name and what they owe, nothing of how to reach them) and a link to their oldest overdue invoice, shown only in
// that answer, so it is copied before the dialog is closed. Nothing is sent from here.
import { formatMoment, formatMoney } from '@radcore/lib-common';
import { listReminders, recordReminder, REMINDER_CHANNELS } from '@radcore/lib-accounts/contract';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextAreaField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';

type Reminder = z.output<typeof listReminders.output>['items'][number];
type Recorded = z.output<typeof recordReminder.output>;

const shape = recordReminder.input.shape;
const schema = z.object({
  channel: z.string().min(1, t('books.collect.rem.channel.none')).pipe(shape.channel),
  note: z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(shape.note),
});
const MESSAGES = { nothing_owed: t('books.collect.err.nothing_owed'), wrong_status: t('books.collect.err.wrong_status') };

const columns: Column<Reminder>[] = [
  { id: 'when', header: t('books.collect.rem.col.when'), cell: (r) => formatMoment(r.asAt) },
  { id: 'channel', header: t('books.collect.rem.col.channel'), cell: (r) => t(`books.collect.rem.channel.${r.channel}`) },
  { id: 'owed', header: t('books.collect.rem.col.owed'), cell: (r) => t('books.collect.rem.owed', { outstanding: formatMoney(r.outstanding), overdue: formatMoney(r.overdue) }) },
  { id: 'note', header: t('books.collect.rem.col.note'), cell: (r) => r.note ?? '' },
  { id: 'by', header: t('books.collect.rem.col.by'), cell: (r) => r.by.displayName ?? '' },
];

/** One piece of text to copy (the words to send, a link): shown in a box, with a button that copies it. */
function CopyBox({ label, text, copyLabel }: { label: string; text: string; copyLabel: string }) {
  const id = useId();
  const [problem, setProblem] = useState('');
  return (
    <div className="kit-field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} readOnly rows={3} value={text} />
      <button type="button" className="kit-button" onClick={() => {
        setProblem('');
        navigator.clipboard.writeText(text).then(() => announce(t('books.collect.rem.copied')), () => setProblem(t('books.collect.rem.copy.err')));
      }}>{copyLabel}</button>
      {problem === '' ? null : <p role="alert" className="kit-form-alert">{problem}</p>}
    </div>
  );
}

/** What recording a reminder answered: the words to send, and the link (or why there is none). */
function Result({ done, onClose }: { done: Recorded; onClose: () => void }) {
  return (
    <>
      <p role="status">{t('books.collect.rem.done')}</p>
      <CopyBox label={t('books.collect.rem.text')} text={done.text} copyLabel={t('books.collect.rem.text.copy')} />
      {done.link === null ? (done.noLink === null ? null : <p>{t(`books.collect.rem.nolink.${done.noLink}`)}</p>) : (
        <>
          <p>{t('books.collect.rem.link.warn', { when: formatMoment(done.link.expiresAt) })}</p>
          <CopyBox label={t('books.collect.rem.link')} text={`${window.location.origin}${done.link.path}`} copyLabel={t('books.collect.rem.link.copy')} />
        </>
      )}
      <div className="kit-actions"><button type="button" className="kit-button kit-button-primary" onClick={onClose}>{t('books.collect.rem.close')}</button></div>
    </>
  );
}

function Record({ id, party, onClose }: { id: string; party: string; onClose: () => void }) {
  const record = useApiMutation(recordReminder, { invalidates: [listReminders] });
  const [done, setDone] = useState<Recorded | null>(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('books.collect.rem.record.title', { party })} description={t('books.collect.rem.record.body')}>
      {done !== null ? <Result done={done} onClose={onClose} /> : (
        <Form schema={schema} saved={false} messages={MESSAGES} defaultValues={{ channel: '', note: '' }}
          onSubmit={async (v) => { setDone(await record.submit({ id, channel: v.channel, ...(v.note === undefined ? {} : { note: v.note }) })); }}>
          <SelectField name="channel" label={t('books.collect.rem.channel')} placeholder={t('books.collect.rem.channel.none')}
            options={REMINDER_CHANNELS.map((c) => ({ value: c, label: t(`books.collect.rem.channel.${c}`) }))} />
          <TextAreaField name="note" label={t('books.collect.rem.note')} />
          <div className="kit-actions">
            <CloseButton>{t('books.collect.rem.close')}</CloseButton>
            <SubmitButton>{t('books.collect.rem.save')}</SubmitButton>
          </div>
        </Form>
      )}
    </Dialog>
  );
}

export function Reminders({ id, party }: { id: string; party: string }) {
  const mayRemind = useMe().permissions.includes('receivables:remind');
  const list = useApiList(listReminders, { id, filter: {} });
  const [recording, setRecording] = useState(false);
  return (
    <section aria-labelledby="reminders-title">
      <h2 id="reminders-title">{t('books.collect.rem.title')}</h2>
      {mayRemind ? <button type="button" className="kit-button kit-button-primary" onClick={() => setRecording(true)}>{t('books.collect.rem.record')}</button> : null}
      <DataTable caption={t('books.collect.rem.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('books.collect.rem.none')} />
      {recording ? <Record id={id} party={party} onClose={() => setRecording(false)} /> : null}
    </section>
  );
}
