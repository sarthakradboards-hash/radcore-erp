'use client';
// The period lock and the financial years (RAD-168 on RAD-157's routes; ADR-009 §6). Under books:lock: the lock moves
// forward here at once, and a move back or a reopen is asked for here and decided on the unlock approvals page by someone
// else holding books:unlock (D-06). A year closes in order, with every year-end checklist item ticked. The server checks
// the order, the dates and the books; the screen only offers the likely action and words its refusals.
import { financialYear, formatDate, formatMoment, indiaDate } from '@radcore/lib-common';
import { askUnlockContract, closeYearContract, getPeriodContract, lockPeriodContract, periodUnlockApproval } from '@radcore/lib-accounts/contract';
import { useId, useState } from 'react';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { CheckboxesField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { PERIOD_MESSAGES, yearAction, type Year } from './years.ts';

const forwardSchema = lockPeriodContract.input;
const askSchema = askUnlockContract.input.omit({ kind: true });
const closeSchema = closeYearContract.input.omit({ start: true });
const blank = { through: '', reason: '' };
// Each change can make the others stale: the lock date, the years' closes, and the queue of requests.
const refresh = [getPeriodContract, periodUnlockApproval.listPending];

/** Moves the lock forward at once, or asks for a move back. */
function LockForms() {
  const forward = useApiMutation(lockPeriodContract, { invalidates: refresh });
  const ask = useApiMutation(askUnlockContract, { invalidates: refresh });
  const forwardId = useId();
  const backId = useId();
  // A request asked shows as waiting, and the form starts again empty, so a second press can't ask twice by accident
  // (e2e-playwright on #428).
  const [asked, setAsked] = useState<{ date: string; round: number } | null>(null);
  return (
    <>
      <section aria-labelledby={forwardId}>
        <h2 id={forwardId}>{t('books.period.forward.title')}</h2>
        <Form schema={forwardSchema} defaultValues={blank} saved={false} messages={PERIOD_MESSAGES} aria-labelledby={forwardId}
          onSubmit={async (v) => {
            const done = await forward.submit(v);
            announce(t('books.period.forward.done', { date: formatDate(done.lockedThrough) }));
          }}>
          <TextField name="through" label={t('books.period.forward.through')} hint={t('books.period.forward.hint')} type="date" />
          <TextAreaField name="reason" label={t('books.reason')} hint={t('books.period.reason.hint')} />
          <div className="kit-actions"><SubmitButton>{t('books.period.forward.submit')}</SubmitButton></div>
        </Form>
      </section>
      <section aria-labelledby={backId}>
        <h2 id={backId}>{t('books.period.back.title')}</h2>
        {asked === null ? null : <p role="status">{t('books.period.back.asked', { date: formatDate(asked.date) })}</p>}
        <Form key={asked?.round ?? 0} schema={askSchema} defaultValues={blank} saved={false} messages={PERIOD_MESSAGES} aria-labelledby={backId}
          onSubmit={async (v) => {
            await ask.submit({ kind: 'move_back', ...v });
            setAsked((was) => ({ date: v.through, round: (was?.round ?? 0) + 1 }));
          }}>
          <TextField name="through" label={t('books.period.back.through')} hint={t('books.period.back.hint')} type="date" />
          <TextAreaField name="reason" label={t('books.reason')} hint={t('books.period.reason.hint')} />
          <div className="kit-actions"><SubmitButton>{t('books.period.back.submit')}</SubmitButton></div>
        </Form>
      </section>
    </>
  );
}

/** Closes a year (F20): the checklist ticked and a reason. */
function CloseDialog({ year, checklist, onDone }: { year: Year; checklist: readonly string[]; onDone: () => void }) {
  const close = useApiMutation(closeYearContract, { invalidates: refresh });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }} title={t('books.period.close.title', { year: year.label })}
      description={t('books.period.close.body')}>
      <Form schema={closeSchema} defaultValues={{ ticks: [], reason: '' }} saved={false} messages={PERIOD_MESSAGES}
        onSubmit={async (v) => {
          const done = await close.submit({ start: year.start, ...v });
          onDone();
          setTimeout(() => announce(done.entry === null ? t('books.period.close.done', { year: year.label })
            : t('books.period.close.doneEntry', { year: year.label, entry: done.entry })), 0);
        }}>
        <CheckboxesField name="ticks" label={t('books.period.close.ticks')} hint={t('books.period.close.ticks.hint')}
          options={checklist.map((item) => ({ value: item, label: item }))} />
        <TextAreaField name="reason" label={t('books.reason')} hint={t('books.period.reason.hint')} />
        <div className="kit-actions">
          <CloseButton>{t('books.period.keep')}</CloseButton>
          <SubmitButton>{t('books.period.close.submit')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

/** Asks to reopen the latest closed year, with the day inside it the lock goes back to. */
function ReopenDialog({ year, onDone }: { year: Year; onDone: () => void }) {
  const ask = useApiMutation(askUnlockContract, { invalidates: refresh });
  const span = financialYear(year.start);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }} title={t('books.period.reopen.title', { year: year.label })}
      description={t('books.period.reopen.body')}>
      <Form schema={askSchema} defaultValues={blank} saved={false} messages={PERIOD_MESSAGES}
        onSubmit={async (v) => {
          await ask.submit({ kind: 'reopen_year', ...v });
          onDone();
          setTimeout(() => announce(t('books.period.asked')), 0);
        }}>
        <TextField name="through" label={t('books.period.reopen.through')} type="date" min={span.start} max={span.end} />
        <TextAreaField name="reason" label={t('books.reason')} hint={t('books.period.reason.hint')} />
        <div className="kit-actions">
          <CloseButton>{t('books.period.keep')}</CloseButton>
          <SubmitButton>{t('books.period.reopen.submit')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

function Years({ years, checklist }: { years: readonly Year[]; checklist: readonly string[] }) {
  const captionId = useId();
  const [acting, setActing] = useState<{ year: Year; action: 'close' | 'reopen' } | null>(null);
  const today = indiaDate(new Date());
  if (years.length === 0) return <p>{t('books.period.years.empty')}</p>;
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t('books.period.years')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.period.col.year')}</th>
              <th scope="col">{t('books.period.col.status')}</th>
              <th scope="col">{t('books.period.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const action = yearAction(years, y.start, today);
              return (
                <tr key={y.start}>
                  <th scope="row">{y.label}</th>
                  <td>{y.closed === null ? t('books.period.open')
                    : t('books.period.closedBy', { who: y.closed.by.displayName ?? t('books.period.someone'), when: formatMoment(y.closed.at) })}</td>
                  <td>
                    {action === null ? null : (
                      <button type="button" className="kit-button" onClick={() => setActing({ year: y, action })}>
                        {t(action === 'close' ? 'books.period.close' : 'books.period.reopen', { year: y.label })}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {acting?.action === 'close' ? <CloseDialog key={acting.year.start} year={acting.year} checklist={checklist} onDone={() => setActing(null)} /> : null}
      {acting?.action === 'reopen' ? <ReopenDialog key={acting.year.start} year={acting.year} onDone={() => setActing(null)} /> : null}
    </div>
  );
}

export default function PeriodPage() {
  const mayLock = useMe().permissions.includes('books:lock');
  const q = useApiQuery(getPeriodContract, {}, { enabled: mayLock });
  const p = q.data;
  const body = !mayLock ? <p>{t('books.period.none')}</p>
    : q.error !== null ? (
      <div role="alert" className="kit-form-alert">
        {t('error.title')}{' '}
        <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
      </div>
    )
    : p === undefined ? <p>{t('loading')}</p>
    : (
      <>
        <dl className="admin-facts" aria-label={t('books.period.facts')}>
          <dt>{t('books.period.lockedThrough')}</dt>
          <dd>{p.lockedThrough === null ? t('books.period.notLocked') : formatDate(p.lockedThrough)}</dd>
        </dl>
        <LockForms />
        <h2>{t('books.period.years')}</h2>
        <Years years={p.years} checklist={p.checklist} />
      </>
    );
  return (
    <>
      <h1>{t('books.period.title')}</h1>
      <p>{t('books.period.intro')}</p>
      {body}
    </>
  );
}
