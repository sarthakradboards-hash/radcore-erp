// The upload routes' services and the upload check (RAD-43, RC-096, RC-191). The browser sends the bytes straight to
// S3; this records what the app knows about them. Only the presigning calls run in a request's transaction
// (ctx.files); checking the upload in S3 is a network call, so a job does it before its own transaction opens
// (ADR-001 §8), and records `ready` or `refused` in it.
import { files, platformTx } from '@radcore/db/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import type { BeforeJob, JobContract, JobMeta } from '../jobs.ts';
import { recordSecurityEvent } from '../security-events.ts';
import { FILE_KINDS, isViewKind, type FileKind } from './kinds.ts';
import { UploadRefused } from './store.ts';

type CheckInput = { id: string; kind: FileKind; key: string };
type Checked = { ok: true; size: number } | { ok: false };

/** Queued by confirmUpload. The id, kind and key come from the file's row, never from the browser. */
export const fileCheck: JobContract<CheckInput> = {
  name: 'platform.file-check',
  principal: { kind: 'system', name: 'file-check', permissions: [] },
  input: z.strictObject({ id: z.uuid(), kind: z.enum(Object.keys(FILE_KINDS) as [FileKind, ...FileKind[]]), key: z.string().min(1) }),
};

/** Before the job's transaction: the S3 check. A refusal is its answer; any other failure (S3 down) is retried. */
export const checkUpload: BeforeJob<CheckInput, Checked> = async ({ kind, key }, { files: store }) => {
  try {
    return { ok: true, size: (await store.verifyUpload(key, kind)).size };
  } catch (err) {
    if (err instanceof UploadRefused) return { ok: false };
    throw err;
  }
};

/** In the job's transaction: the check's answer, on a file still checking. A repeated job changes nothing. */
export async function recordFileCheck(ctx: Ctx, { id, key }: CheckInput, { before }: JobMeta & { before: Checked }): Promise<void> {
  await platformTx(ctx).update(files).set(before.ok ? { status: 'ready', size: before.size } : { status: 'refused' })
    .where(and(eq(files.id, id), eq(files.storeKey, key), eq(files.status, 'checking')));
}

/**
 * A kind's three services, for its contracts in ./contract (photoFiles and the rest). Another kind's id is not_found.
 * shortcut: access is per kind, not per record; once files attach to bills or HR records, reading one should follow
 * its parent record's access (auditor-2, RAD-43).
 */
const fileServices = (kind: FileKind) => Object.freeze({
  async startUpload(ctx: Ctx, { filename, contentType }: { filename: string; contentType: string }) {
    const { key, url, fields } = await ctx.files.presignUpload(kind, contentType);
    const [row] = await platformTx(ctx).insert(files).values({ kind, storeKey: key, filename, contentType })
      .returning({ id: files.id });
    if (row === undefined) throw new Error('the file row was not stored');
    return { id: row.id, url, fields };
  },

  async confirmUpload(ctx: Ctx, { id }: { id: string }) {
    const tx = platformTx(ctx);
    const [row] = await tx.update(files).set({ status: 'checking' })
      .where(and(eq(files.id, id), eq(files.kind, kind), eq(files.status, 'pending'))).returning({ key: files.storeKey });
    if (row === undefined) {
      const [known] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, id), eq(files.kind, kind)));
      throw known === undefined ? new AppError('not_found', 'Not found')
        : new AppError('not_pending', 'This file was confirmed already');
    }
    await ctx.jobs.send(fileCheck, { id, kind, key: row.key });
    return { status: 'checking' as const };
  },

  async downloadLink(ctx: Ctx, { id }: { id: string }) {
    const [row] = await platformTx(ctx).select({ key: files.storeKey, filename: files.filename, status: files.status })
      .from(files).where(and(eq(files.id, id), eq(files.kind, kind)));
    if (row === undefined) throw new AppError('not_found', 'Not found');
    if (row.status === 'refused') {
      throw new AppError('upload_refused', 'This file didn\'t pass its check (size, type or content). Upload it again');
    }
    if (row.status !== 'ready') throw new AppError('not_ready', 'This file is still being checked. Try again in a moment');
    // Every link handed out is a download (RC-031): the event commits with this answer, or neither does.
    await recordSecurityEvent(ctx, { kind: 'download', detail: { fileId: id } },
      { userId: ctx.principal.kind === 'user' ? ctx.principal.userId : null, device: null });
    return { url: await ctx.files.downloadUrl(row.key, row.filename) };
  },
});
export const photoFileService = fileServices('photo');
/** Item pictures upload and confirm like any kind; they're seen through viewLinks, never downloaded (RAD-89). */
export const itemPictureFileService = fileServices('item_picture');

/** A ready file of `kind`, for a module attaching it to its own record (item pictures, RAD-89). Another kind's id is
 * not_found; a file still checking is not_ready, and one the check refused is upload_refused, as a download says. */
export async function readyFile(ctx: Ctx, kind: FileKind, id: string): Promise<{ id: string }> {
  const [row] = await platformTx(ctx).select({ status: files.status }).from(files).where(and(eq(files.id, id), eq(files.kind, kind)));
  if (row === undefined) throw new AppError('not_found', 'Not found');
  if (row.status === 'refused') throw new AppError('upload_refused', 'This file didn\'t pass its check (size, type or content). Upload it again');
  if (row.status !== 'ready') throw new AppError('not_ready', 'This file is still being checked. Try again in a moment');
  return { id };
}

/**
 * View links for a view kind's files (item pictures, RAD-89; ADR-004 §2): inline, as the checked content type, and
 * with no download event, since such a file isn't sensitive. Every other kind is a download (RC-031), so asking for
 * one here is a mistake in the code, not the request. A file that isn't ready, or is another kind, gets no link.
 */
export async function viewLinks(ctx: Ctx, kind: FileKind, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (!isViewKind(kind)) throw new TypeError(`${kind} files are downloaded, with an event, not viewed`);
  if (ids.length === 0) return new Map();
  const rows = await platformTx(ctx).select({ id: files.id, key: files.storeKey, contentType: files.contentType }).from(files)
    .where(and(inArray(files.id, [...ids]), eq(files.kind, kind), eq(files.status, 'ready')));
  return new Map(await Promise.all(rows.map(async (r) => [r.id, await ctx.files.viewUrl(r.key, r.contentType)] as const)));
}
export const resumeFileService = fileServices('resume');
export const statementFileService = fileServices('statement');
export const importFileService = fileServices('import');
