'use client';
// A delivered booking's checklist (RAD-127 on RAD-117's contracts, RC-208): the inspection, the rider's briefing, the warranty
// registered, and a photo and a signed note, each a file uploaded as its own kind (delivery_photo, delivery_note). Saved whole,
// as often as needed; the invoice never waits for it, and the server says whether it is complete. An upload is RAD-43's three
// steps (start, send to the bucket, confirm); the checklist then names the file, and a file still being checked answers
// not_ready, so saving tries again shortly, each try under a new key (a refusal is kept under its key). The kind of each
// file, and that it passed its check, are the server's to say; the screen words the refusals.
import { deliveryNoteFiles, deliveryPhotoFiles } from '@radcore/lib-platform/contract';
import { getBooking, listBookings, saveBookingChecklist } from '@radcore/lib-sales/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useController } from 'react-hook-form';
import { z } from 'zod';
import { CheckboxField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton, useFieldName } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { ApiError, callContract } from '../../../../../lib/api-client.ts';
import { keyOf } from '../../../../../lib/api/query.ts';
import { BucketRefused, postToBucket } from '../../../../../lib/files/post-to-bucket.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { BOOKING_MESSAGES } from '../shared.ts';

const CHECK_TRIES = 30;
const CHECK_EVERY_MS = 2000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Kind = typeof deliveryPhotoFiles | typeof deliveryNoteFiles;

/** The three steps of an upload: a presigned POST, the file sent straight to the bucket, and the check started. */
async function upload(kind: Kind, file: File): Promise<string> {
  const { id, url, fields } = await callContract(kind.startUpload, { filename: file.name, contentType: file.type as never }, { idempotencyKey: crypto.randomUUID() });
  await postToBucket(url, fields, file);
  await callContract(kind.confirmUpload, { id }, { idempotencyKey: crypto.randomUUID() });
  return id;
}

/** What a refused download says: these are not the upload's words ("choose another" makes no sense here). */
const DOWNLOAD_MESSAGES: Partial<Record<string, string>> = {
  not_ready: t('sales.booking.checklist.download.err.not_ready'), upload_refused: t('sales.booking.checklist.download.err.refused'),
};

/** A saved file's download: a short-lived link from the server, followed in this tab (a new tab opened after the wait would be
 * blocked as a pop-up). A refusal is said, not lost. */
function DownloadButton({ kind, id, label }: { kind: Kind; id: string; label: string }) {
  const [problem, setProblem] = useState('');
  return (
    <>
      <button type="button" className="kit-button" aria-label={`${t('sales.booking.checklist.file.download')}: ${label}`}
        onClick={() => {
          setProblem('');
          callContract(kind.downloadLink, { id }, { idempotencyKey: crypto.randomUUID() }).then(({ url }) => window.location.assign(url)).catch((e: unknown) => {
            setProblem(e instanceof ApiError ? (DOWNLOAD_MESSAGES[e.code] ?? e.envelope.message) : t('sales.booking.checklist.err.offline'));
          });
        }}>
        {t('sales.booking.checklist.file.download')}
      </button>
      {problem === '' ? null : <span role="alert" className="kit-form-alert">{problem}</span>}
    </>
  );
}

/** One file of the checklist: what is attached, a download of what is saved, and a box to send a new one. */
function FileBox({ name, kind, saved, label, hint, onBusy }: {
  name: 'photoId' | 'noteId'; kind: Kind; saved: string | null; label: string; hint: string; onBusy: (delta: 1 | -1) => void;
}) {
  useFieldName(name);
  const { field } = useController<{ photoId: string | null; noteId: string | null }, typeof name>({ name });
  const [state, setState] = useState<{ said: string; problem: string }>({ said: '', problem: '' });
  const types = kind.startUpload.input.shape.contentType.options.join(',');
  const send = async (file: File) => {
    setState({ said: t('sales.booking.checklist.file.uploading'), problem: '' });
    onBusy(1);
    try {
      field.onChange(await upload(kind, file));
      setState({ said: '', problem: '' });
    } catch (e) {
      setState({ said: '', problem: e instanceof BucketRefused ? t('sales.booking.checklist.err.bucket')
        : e instanceof ApiError ? (BOOKING_MESSAGES[e.code] ?? e.envelope.issues[0]?.message ?? e.envelope.message) : t('sales.booking.checklist.err.offline') });
    } finally {
      onBusy(-1);
    }
  };
  const value: string | null = field.value;
  return (
    <div className="kit-field">
      <span id={`${name}-label`}>{label}</span>
      <p className="kit-field-hint">{hint}</p>
      <p>
        {value === null ? t('sales.booking.checklist.file.none') : value === saved ? t('sales.booking.checklist.file.attached') : t('sales.booking.checklist.file.new')}
        {' '}
        {saved === null ? null : <DownloadButton kind={kind} id={saved} label={label} />}
      </p>
      <input type="file" accept={types} aria-labelledby={`${name}-label`}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // the same file can be chosen again after a refusal
          if (file !== undefined) void send(file);
        }} />
      <p role="status">{state.said}</p>
      {state.problem === '' ? null : <p role="alert" className="kit-form-alert">{state.problem}</p>}
    </div>
  );
}

const schema = z.object({
  inspected: z.boolean(), briefed: z.boolean(), warrantyRegistered: z.boolean(), photoId: z.string().nullable(), noteId: z.string().nullable(),
});

export type ChecklistState = {
  inspected: boolean; briefed: boolean; warrantyRegistered: boolean; photoId: string | null; noteId: string | null; complete: boolean;
};

/** Saves the checklist, trying again while a file is still being checked. */
async function saveWhenChecked(input: z.input<typeof saveBookingChecklist.input>): Promise<{ complete: boolean }> {
  for (let n = 0; n < CHECK_TRIES; n++) {
    try {
      return await callContract(saveBookingChecklist, input, { idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'not_ready') || n === CHECK_TRIES - 1) throw e;
      await wait(CHECK_EVERY_MS);
    }
  }
  throw new Error('unreachable');
}

/** What a person without bookings:write sees: the checklist as it stands, and the saved files to download. */
function ReadOnly({ checklist }: { checklist: ChecklistState }) {
  const yes = (v: boolean) => (v ? t('sales.booking.checklist.yes') : t('sales.booking.checklist.no'));
  return (
    <dl className="admin-facts" aria-label={t('sales.booking.checklist.title')}>
      <dt>{t('sales.booking.checklist.inspected')}</dt><dd>{yes(checklist.inspected)}</dd>
      <dt>{t('sales.booking.checklist.briefed')}</dt><dd>{yes(checklist.briefed)}</dd>
      <dt>{t('sales.booking.checklist.warranty')}</dt><dd>{yes(checklist.warrantyRegistered)}</dd>
      <dt>{t('sales.booking.checklist.photo')}</dt>
      <dd>{checklist.photoId === null ? t('sales.booking.checklist.file.none') : <DownloadButton kind={deliveryPhotoFiles} id={checklist.photoId} label={t('sales.booking.checklist.photo')} />}</dd>
      <dt>{t('sales.booking.checklist.note')}</dt>
      <dd>{checklist.noteId === null ? t('sales.booking.checklist.file.none') : <DownloadButton kind={deliveryNoteFiles} id={checklist.noteId} label={t('sales.booking.checklist.note')} />}</dd>
    </dl>
  );
}

export function Checklist({ id, checklist, mayWrite }: { id: string; checklist: ChecklistState; mayWrite: boolean }) {
  const client = useQueryClient();
  // Saving waits for a file being sent: the file's id only arrives when it is, and saving before would leave it out.
  const [uploading, setUploading] = useState(0);
  const onBusy = (delta: 1 | -1) => setUploading((n) => n + delta);
  const heading = (
    <>
      <h2 id="checklist-title">{t('sales.booking.checklist.title')}</h2>
      <p>{t('sales.booking.checklist.intro')} {checklist.complete ? t('sales.booking.checklist.complete') : t('sales.booking.checklist.incomplete')}.</p>
    </>
  );
  if (!mayWrite) return <section aria-labelledby="checklist-title">{heading}<ReadOnly checklist={checklist} /></section>;
  return (
    <section aria-labelledby="checklist-title">
      {heading}
      <Form aria-labelledby="checklist-title" schema={schema} saved={false} messages={BOOKING_MESSAGES}
        defaultValues={{ inspected: checklist.inspected, briefed: checklist.briefed, warrantyRegistered: checklist.warrantyRegistered,
          photoId: checklist.photoId, noteId: checklist.noteId }}
        onSubmit={async (v) => {
          const done = await saveWhenChecked({ id, ...v });
          await Promise.all([client.invalidateQueries({ queryKey: keyOf(getBooking) }), client.invalidateQueries({ queryKey: keyOf(listBookings) })]);
          setTimeout(() => announce(done.complete ? t('sales.booking.checklist.saved.complete') : t('sales.booking.checklist.saved')), 0);
        }}>
        <CheckboxField name="inspected" label={t('sales.booking.checklist.inspected')} />
        <CheckboxField name="briefed" label={t('sales.booking.checklist.briefed')} />
        <CheckboxField name="warrantyRegistered" label={t('sales.booking.checklist.warranty')} />
        <FileBox name="photoId" kind={deliveryPhotoFiles} saved={checklist.photoId} label={t('sales.booking.checklist.photo')}
          hint={t('sales.booking.checklist.file.hint.photo')} onBusy={onBusy} />
        <FileBox name="noteId" kind={deliveryNoteFiles} saved={checklist.noteId} label={t('sales.booking.checklist.note')}
          hint={t('sales.booking.checklist.file.hint.note')} onBusy={onBusy} />
        <SubmitButton disabled={uploading > 0}>{t('sales.booking.checklist.save')}</SubmitButton>
      </Form>
    </section>
  );
}
