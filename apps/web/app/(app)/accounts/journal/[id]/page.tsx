'use client';
// One journal entry (RAD-100 on RAD-86's routes): its facts, its reason, and its lines with their totals. An entry is
// never edited. journal:reverse (which the server grants only with the second factor) reverses a manual journal once,
// dated the reversal's own day and with a reason; the reversal and the entry link to each other. A document's entry
// (an invoice's, a bill's) is undone by cancelling its document, never here.
import { dec, formatDate, formatMoment, formatMoney, formatNumber, indiaDate, sum } from '@radcore/lib-common';
import { getJournal, listJournal, reverseJournal } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';
import { JOURNAL_MESSAGES, kindText, postedBy, type EntryDetail } from '../../shared.tsx';

const reverseSchema = reverseJournal.input.omit({ id: true });

function Lines({ e }: { e: EntryDetail }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t('books.entry.lines', { number: e.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.entry.account')}</th>
              <th scope="col" className="kit-numeric">{t('books.entry.debit')}</th>
              <th scope="col" className="kit-numeric">{t('books.entry.credit')}</th>
            </tr>
          </thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.lineNo}>
                <td>{l.account.name}</td>
                <td className="kit-numeric">{dec(l.debit).isZero() ? '' : formatNumber(l.debit, 2)}</td>
                <td className="kit-numeric">{dec(l.credit).isZero() ? '' : formatNumber(l.credit, 2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('books.entry.totals')}</th>
              <td className="kit-numeric">{formatNumber(sum(e.lines.map((l) => l.debit)), 2)}</td>
              <td className="kit-numeric">{formatNumber(sum(e.lines.map((l) => l.credit)), 2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayReverse = useMe().permissions.includes('journal:reverse');
  const q = useApiQuery(getJournal, { id });
  const reverse = useApiMutation(reverseJournal, { invalidates: [getJournal, listJournal] });
  const [reversing, setReversing] = useState(false);
  const e = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/accounts/journal">{t('books.entry.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('books.entry.missing')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (e === undefined) return <p>{t('loading')}</p>;
  // Only a manual journal is reversed here; a document's entry is undone by cancelling its document.
  const manual = e.kind === 'manual';
  const reversible = manual && e.reversedBy === null && e.reversesEntryId === null;
  // A bank charge has no document: unmatching its statement line undoes it (e2e-2 on #461). Once undone, nothing's to say.
  const undoneBy = e.kind !== 'bank_charge' ? t('books.entry.byDocument')
    : e.reversedBy === null && e.reversesEntryId === null ? t('books.bank.charge.entry') : null;

  return (
    <>
      <p><Link href="/accounts/journal">{t('books.entry.back')}</Link></p>
      <h1>{e.number}</h1>
      <dl className="admin-facts" aria-label={t('books.entry.facts')}>
        <dt>{t('books.journal.date')}</dt><dd>{formatDate(e.businessDate)}</dd>
        <dt>{t('books.journal.kind')}</dt><dd>{kindText(e.kind)}</dd>
        <dt>{t('books.journal.total')}</dt><dd>{formatMoney(e.total)}</dd>
        <dt>{t('books.journal.who')}</dt><dd>{t('books.entry.postedAt', { who: postedBy(e.postedBy), when: formatMoment(e.postedAt) })}</dd>
        <dt>{t('books.entry.reason')}</dt><dd>{e.reason ?? t('books.entry.noReason')}</dd>
        {e.reversedBy === null ? null : (
          <><dt>{t('books.journal.status')}</dt><dd><Link href={`/accounts/journal/${e.reversedBy}`}>{t('books.entry.reversedBy')}</Link></dd></>
        )}
        {e.reversesEntryId === null ? null : (
          <><dt>{t('books.journal.status')}</dt><dd><Link href={`/accounts/journal/${e.reversesEntryId}`}>{t('books.entry.reverses')}</Link></dd></>
        )}
      </dl>
      <Lines e={e} />
      {manual || undoneBy === null ? null : <p>{undoneBy}</p>}
      {mayReverse && reversible ? (
        <div className="kit-actions">
          <button type="button" className="kit-button" onClick={() => setReversing(true)}>{t('books.reverse')}</button>
        </div>
      ) : null}

      <Dialog open={reversing} onOpenChange={setReversing} title={t('books.reverse.title', { number: e.number })}
        description={t('books.reverse.body')}>
        <Form schema={reverseSchema} saved={false} messages={JOURNAL_MESSAGES}
          defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => {
            const done = await reverse.submit({ id: e.id, ...v });
            setReversing(false);
            setTimeout(() => announce(t('books.reverse.done', { number: done.number })), 0);
            router.push(`/accounts/journal/${done.id}`);
          }}>
          <TextField name="businessDate" label={t('books.reverse.date')} hint={t('books.reverse.date.hint')} type="date" />
          <TextAreaField name="reason" label={t('books.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('books.cancel')}</CloseButton>
            <SubmitButton>{t('books.reverse')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
