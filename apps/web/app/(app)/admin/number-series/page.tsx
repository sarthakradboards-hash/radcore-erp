'use client';
// Number series (RAD-133 on RAD-132's contract, ADR-006 §3): each series' prefix in force this financial year, next
// year's, and the next number. settings:read sees them; settings:write (the second factor, a reason) changes a prefix.
// A year keeps the prefix its first number drew, so a change for next year takes effect from next year's first day, and
// one for this year is offered only while no number has been drawn in it (the server holds the same line: series_in_use).
import { listNumberSeries, setSeriesPrefix } from '@radcore/lib-platform/contract';
import { formatDate } from '@radcore/lib-common';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { RadioField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { MESSAGES } from '../shared.tsx';
import type { Series } from '../settings/types.ts';

const shape = setSeriesPrefix.input.shape;
// Capitals are what a prefix is, so typing lower case reads as the capitals; the server's rule still decides.
const schema = z.object({ prefix: z.string().trim().toUpperCase().pipe(shape.prefix), from: shape.from, reason: shape.reason });
const SERIES_MESSAGES = { ...MESSAGES, series_in_use: t('admin.series.err.in_use') };
const later = (text: string) => setTimeout(() => announce(text), 0);

export default function NumberSeriesPage() {
  const captionId = useId();
  const mayWrite = useMe().permissions.includes('settings:write');
  const q = useApiQuery(listNumberSeries, {});
  const save = useApiMutation(setSeriesPrefix, { invalidates: [listNumberSeries] });
  const [changing, setChanging] = useState<Series | null>(null);
  const data = q.data;

  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (data === undefined) return <p>{t('loading')}</p>;
  const { thisYear, nextYear } = data;
  const fromNext = t('admin.series.fromNext', { when: formatDate(nextYear.start), year: nextYear.label });

  return (
    <>
      <h1>{t('admin.series.title')}</h1>
      <p>{t('admin.series.intro', { year: thisYear.label })}</p>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('admin.series.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.series.col.series')}</th>
                <th scope="col">{t('admin.series.col.thisYear', { year: thisYear.label })}</th>
                <th scope="col">{t('admin.series.col.nextYear', { year: nextYear.label })}</th>
                <th scope="col">{t('admin.series.col.next')}</th>
                {mayWrite ? <th scope="col">{t('admin.users.col.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.series.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td>{s.prefixThisYear}</td>
                  <td>{s.prefixNextYear}</td>
                  <td>{s.next}</td>
                  {mayWrite ? (
                    <td>
                      <button type="button" className="kit-button" onClick={() => setChanging(s)}
                        aria-label={t('admin.series.changeFor', { name: s.label })}>{t('admin.series.change')}</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={changing !== null} onOpenChange={(open) => { if (!open) setChanging(null); }}
        title={t('admin.series.change.title', { name: changing?.label ?? '' })} description={t('admin.series.change.body', { when: formatDate(nextYear.start), year: nextYear.label })}>
        {changing === null ? null : (
          <Form schema={schema} saved={false} messages={SERIES_MESSAGES}
            defaultValues={{ prefix: changing.prefixNextYear, from: 'next_year', reason: '' }}
            onSubmit={async (v) => {
              const done = await save.submit({ key: changing.key, ...v });
              setChanging(null);
              later(t('admin.series.changed', { name: changing.label, prefix: v.prefix, from: done.fromYear }));
            }}>
            <TextField name="prefix" label={t('admin.series.prefix')} hint={t('admin.series.prefix.hint')} autoComplete="off" autoCapitalize="characters" />
            <RadioField name="from" label={t('admin.series.from')} options={[
              { value: 'next_year', label: fromNext },
              ...(changing.thisYearDrawn ? [] : [{ value: 'this_year', label: t('admin.series.fromNow', { year: thisYear.label }) }]),
            ]} hint={changing.thisYearDrawn ? t('admin.series.drawn', { year: thisYear.label }) : undefined} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.series.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
