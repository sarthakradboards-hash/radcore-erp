// The export engine (RAD-47 part 2, ADR-002 Exports, ADR-001 §8b). A module supplies the rows, page by page, through
// the same keyset paging as its screen; the engine streams them to a CSV file on the size-limited export volume, then
// the job uploads it after its transaction commits. An export is complete or it fails, never cut short (RC-086):
// past EXPORT_MAX_ROWS, or when the volume fills, it fails `too_large` and keeps no file.
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dataExports, platformTx } from '@radcore/db/platform';
import { and, eq, gt } from 'drizzle-orm';
import type { z } from 'zod';
import { EXPORT_MAX_ROWS, type downloadExport, type getExport } from './contract.ts';
import { principalId, type Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { recordSecurityEvent } from '../security-events.ts';
import { csvWriter } from './csv.ts';

/** One row of an export: its columns' values, written as text. */
export type ExportRow = Readonly<Record<string, string | number | null>>;

/** A module's page of rows for an export: the screen's own list, with its keyset cursor. */
export type ExportRows<F> = (ctx: Ctx, filter: F, page: { after?: string; limit: number }) =>
  Promise<{ items: readonly ExportRow[]; next: string | null }>;

/** What the writer needs of an export: its list, its columns in order (each a key of the rows) and its rows. */
export type ExportDefinition<F> = {
  /** The list, `<module>.<name>`, such as `sales.invoices`. */
  readonly kind: string;
  readonly columns: readonly string[];
  readonly rows: ExportRows<F>;
};

/** An export past its cap, or one that filled the export volume (ENOSPC): it fails `too_large`. */
export class ExportTooLarge extends Error {
  override name = 'ExportTooLarge';
}

/**
 * How long an export may stay queued before it counts as failed (auditor on #125): a job that was refused (its starter
 * gone, or their permission revoked) or whose worker died never marks its row, so its status would read queued for
 * ever. Past this it reads `failed`, and no longer blocks the person's next export.
 * shortcut: a fixed six hours, comfortably past one job's hour plus the queue; mark the row from the dead-letter path
 * if a backlog ever makes honest exports wait that long.
 */
export const EXPORT_GIVE_UP_MS = 6 * 3_600_000;
/** When an export queued before now is given up on. */
const givenUpBefore = (): Date => new Date(Date.now() - EXPORT_GIVE_UP_MS);

/** Rows read per page: the screen's paging, sized so memory stays flat however long the export. */
const PAGE = 1_000;

/**
 * Writes every row of an export to `path` as CSV, page by page, inside the caller's read-only snapshot, and answers
 * how many. Past `cap` rows it stops and throws ExportTooLarge; a full volume does too. On any failure the partial
 * file is removed, so nothing truncated is left to upload.
 */
export async function writeExportFile<F>(ctx: Ctx, def: ExportDefinition<F>, filter: F, path: string,
  cap: number = EXPORT_MAX_ROWS): Promise<number> {
  const csv = csvWriter(def.columns);
  // pipeline closes the file on success and destroys both streams on any error, so nothing is left open.
  const done = pipeline(csv, createWriteStream(path));
  let rows = 0;
  try {
    let after: string | undefined;
    do {
      const page = await def.rows(ctx, filter, { ...(after === undefined ? {} : { after }), limit: PAGE });
      rows += page.items.length;
      if (rows > cap) throw new ExportTooLarge(`${def.kind}: more than ${String(cap)} rows`);
      for (const row of page.items) {
        if (!csv.write(row)) await new Promise((resolve) => csv.once('drain', resolve));
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    csv.end();
    await done;
    return rows;
  } catch (error) {
    csv.destroy(error instanceof Error ? error : new Error('export failed'));
    await done.catch(() => undefined);
    await rm(path, { force: true });
    if ((error as { code?: string }).code === 'ENOSPC') throw new ExportTooLarge(`${def.kind}: the export volume is full`);
    throw error;
  }
}

/** The person's own export, or not_found: an export is only ever its starter's. */
async function ownExport(ctx: Ctx, id: string) {
  const [row] = await platformTx(ctx).select({ id: dataExports.id, kind: dataExports.kind, status: dataExports.status,
    rows: dataExports.rows, storeKey: dataExports.storeKey, failure: dataExports.failure, createdAt: dataExports.createdAt })
    .from(dataExports)
    .where(and(eq(dataExports.id, id), eq(dataExports.createdBy, principalId(ctx.principal)))).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such export');
  return row;
}

/** getExport: the status of the person's own export. */
export async function exportStatus(ctx: Ctx, input: z.output<typeof getExport.input>,
): Promise<z.input<typeof getExport.output>> {
  const row = await ownExport(ctx, input.id);
  if (row.status === 'queued' && row.createdAt < givenUpBefore()) return { status: 'failed', rows: null, failure: 'failed' };
  const failure = row.failure === 'too_large' || row.failure === 'failed' ? row.failure : null;
  return { status: row.status === 'ready' || row.status === 'failed' ? row.status : 'queued', rows: row.rows, failure };
}

/** The person's export still queued and not given up on, if any: they may have one at a time (auditor on #125). */
export async function queuedExport(ctx: Ctx): Promise<boolean> {
  const [row] = await platformTx(ctx).select({ id: dataExports.id }).from(dataExports)
    .where(and(eq(dataExports.createdBy, principalId(ctx.principal)), eq(dataExports.status, 'queued'),
      gt(dataExports.createdAt, givenUpBefore()))).limit(1);
  return row !== undefined;
}

/** downloadExport: a short-lived link to the person's own ready export, recorded as a `download` event (RC-031). */
export async function exportDownload(ctx: Ctx, input: z.output<typeof downloadExport.input>,
): Promise<z.input<typeof downloadExport.output>> {
  const row = await ownExport(ctx, input.id);
  if (row.status !== 'ready' || row.storeKey === null) throw new AppError('not_ready', 'This export is not ready to download');
  const url = await ctx.files.downloadUrl(row.storeKey, `${row.kind}.csv`);
  await recordSecurityEvent(ctx, { kind: 'download', detail: { fileId: row.id } },
    { userId: ctx.principal.kind === 'user' ? ctx.principal.userId : null, device: null });
  return { url };
}
