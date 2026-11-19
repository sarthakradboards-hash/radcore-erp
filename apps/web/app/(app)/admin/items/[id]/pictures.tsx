'use client';
// An item's pictures (RAD-99 on RAD-89's and RAD-43's contracts): shown inline from the item's own answer, and for
// items:write added and taken off. Adding is RAD-43's three steps, then attaching: startUpload gives a presigned POST,
// the browser sends the file straight to the bucket (postToBucket), confirmUpload starts the check, and the picture is
// attached once the check passes. Taking one off keeps the file (D-12). The server refuses what it must (more than 8,
// a type or size the bucket's policy won't take, a file that fails its check); the screen words each.
import { itemPictureFiles } from '@radcore/lib-platform/contract';
import { attachItemPicture, removeItemPicture } from '@radcore/lib-stock/contract';
import Image from 'next/image';
import { useId, useState } from 'react';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { ApiError, callContract } from '../../../../../lib/api-client.ts';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { BucketRefused, postToBucket } from '../../../../../lib/files/post-to-bucket.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../shared.tsx';
import type { StockItem } from '../../types.ts';

const TYPES = itemPictureFiles.startUpload.input.shape.contentType.options;
const MAX_PICTURES = 8; // the contract's .max(8) on an item's pictures
const CHECK_TRIES = 30;
const CHECK_EVERY_MS = 2000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attaches the file once its check has passed: not_ready means it's still being checked, so try again shortly, each
 * time as a new request with its own key (a refusal is kept under its key, so the same key would get not_ready back).
 * picture_attached means an earlier try got through and only its answer was lost.
 */
async function attachWhenChecked(itemId: string, fileId: string): Promise<void> {
  for (let n = 0; n < CHECK_TRIES; n++) {
    try {
      await callContract(attachItemPicture, { id: itemId, fileId }, { idempotencyKey: crypto.randomUUID() });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'picture_attached') return;
      if (!(e instanceof ApiError && e.code === 'not_ready')) throw e;
      await wait(CHECK_EVERY_MS);
    }
  }
  throw new ApiError(409, { code: 'not_ready', message: 'Still being checked', issues: [], requestId: '' });
}

const PROBLEMS: Partial<Record<string, string>> = {
  too_many_pictures: t('admin.items.pictures.err.too_many'),
  upload_refused: t('admin.items.pictures.err.refused'),
  not_ready: t('admin.items.pictures.err.slow'),
};

export function Pictures({ item, mayWrite, changed }: { item: StockItem; mayWrite: boolean; changed: () => void }) {
  const inputId = useId();
  const start = useApiMutation(itemPictureFiles.startUpload);
  const confirm = useApiMutation(itemPictureFiles.confirmUpload);
  const remove = useApiMutation(removeItemPicture);
  const [state, setState] = useState<{ busy: boolean; said: string; problem: string }>({ busy: false, said: '', problem: '' });
  const [removing, setRemoving] = useState<string | null>(null);
  const full = item.pictures.length >= MAX_PICTURES;

  const add = async (file: File) => {
    setState({ busy: true, said: t('admin.items.pictures.uploading'), problem: '' });
    try {
      const { id, url, fields } = await start.submit({ filename: file.name, contentType: file.type });
      await postToBucket(url, fields, file);
      await confirm.submit({ id });
      setState({ busy: true, said: t('admin.items.pictures.checking.now'), problem: '' });
      await attachWhenChecked(item.id, id);
      setState({ busy: false, said: '', problem: '' });
      announce(t('admin.items.pictures.added'));
      changed();
    } catch (e) {
      const problem = e instanceof BucketRefused ? t('admin.items.pictures.err.bucket')
        : e instanceof ApiError ? (PROBLEMS[e.code] ?? e.envelope.issues[0]?.message ?? e.envelope.message)
          : t('admin.items.pictures.err.offline');
      setState({ busy: false, said: '', problem });
    }
  };

  return (
    <>
      <h2 id="pictures-title">{t('admin.items.pictures')}</h2>
      {item.pictures.length === 0 ? <p>{t('admin.items.pictures.none')}</p> : (
        <ul aria-labelledby="pictures-title" className="admin-cards">
          {item.pictures.map((p, n) => (
            <li key={p.fileId}>
              {p.url === null ? <span className="admin-card-blank">{t('admin.items.pictures.checking')}</span>
                : <Image src={p.url} alt={t('admin.items.pictures.alt', { name: item.name, n: String(n + 1) })} width={240} height={160} unoptimized />}
              {mayWrite ? (
                <button type="button" className="kit-button" onClick={() => setRemoving(p.fileId)}
                  aria-label={t('admin.items.pictures.remove.label', { n: String(n + 1) })}>{t('admin.items.pictures.remove')}</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {mayWrite ? (
        <div className="kit-field">
          <label htmlFor={inputId}>{t('admin.items.pictures.add')}</label>
          <p id={`${inputId}-hint`} className="kit-field-hint">
            {full ? t('admin.items.pictures.full') : t('admin.items.pictures.add.hint')}
          </p>
          <input id={inputId} type="file" accept={TYPES.join(',')} disabled={state.busy || full} aria-describedby={`${inputId}-hint`}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = ''; // the same file can be chosen again after a refusal
              if (file !== undefined) void add(file);
            }} />
          <p role="status">{state.said}</p>
          {state.problem === '' ? null : <p role="alert" className="kit-form-alert">{state.problem}</p>}
        </div>
      ) : null}
      <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={t('admin.items.pictures.remove.title')} body={t('admin.items.pictures.remove.body')}
        action={t('admin.items.pictures.remove')} done={t('admin.items.pictures.removed')}
        onConfirm={async () => {
          if (removing !== null) await remove.submit({ id: item.id, fileId: removing });
          changed();
        }} />
    </>
  );
}
