// The upload routes' services and the upload check (RAD-43, RC-096, RC-191). The browser sends the bytes straight to
// S3; this records what the app knows about them. Only the presigning calls run in a request's transaction
// (ctx.files); checking the upload in S3 is a network call, so a job does it before its own transaction opens
// (ADR-001 §8), and records `ready` or `refused` in it.
import { files, platformTx } from '@radcore/db/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import type { BeforeJob, JobContract, JobMeta } from '../jobs.ts';
import { FILE_KINDS, type FileKind } from './kinds.ts';
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

/** A kind's three services, for its contracts in ./contract (photoFiles and the rest). Another kind's id is not_found. */
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
    // shortcut: no security event for the download yet (RC-031); it's recorded here once RAD-31's recordSecurityEvent
    // is on dev, and this route's transaction becomes a write.
    return { url: await ctx.files.downloadUrl(row.key, row.filename) };
  },
});
export const photoFileService = fileServices('photo');
export const resumeFileService = fileServices('resume');
export const statementFileService = fileServices('statement');
export const importFileService = fileServices('import');
