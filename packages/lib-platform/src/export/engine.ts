// The export engine (RAD-47 part 2, ADR-002 Exports, ADR-001 §8b). A module supplies the rows, page by page, through
// the same keyset paging as its screen; the engine streams them to a CSV file on the size-limited export volume, then
// the job uploads it after its transaction commits. An export is complete or it fails, never cut short (RC-086):
// past EXPORT_MAX_ROWS, or when the volume fills, it fails `too_large` and keeps no file.
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { dataExports, platformTx } from '@radcore/db/platform';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { EXPORT_MAX_ROWS, type downloadExport, type getExport } from '../contract.ts';
import { principalId, type Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { recordSecurityEvent } from '../security-events.ts';
import { csvWriter } from './csv.ts';

/** One row of an export: its columns' values, written as text. */
export type ExportRow = Readonly<Record<string, string | number | null>>;

/** A module's page of rows for an export: the screen's own list, with its keyset cursor. */
export type ExportRows<F> = (ctx: Ctx, filter: F, page: { after?: string; limit: number }) =>
  Promise<{ items: readonly ExportRow[]; next: string | null }>;

/** A module's export (ADR-001 §8b): which list, who may run it, its filter's schema, its columns and its rows. */
export type ExportDefinition<F> = {
  /** The list, `<module>.<name>`, such as `sales.invoices`; also the file's name. */
  readonly kind: string;
  /** The permission to start it, checked again when the job runs. */
  readonly perm: string;
  readonly filter: z.ZodType<F>;
  /** The CSV's columns, in order: each is a key of the rows. */
  readonly columns: readonly string[];
  readonly rows: ExportRows<F>;
};

/** An export past its cap, or one that filled the export volume (ENOSPC): it fails `too_large`. */
export class ExportTooLarge extends Error {
  override name = 'ExportTooLarge';
}

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
  const out = csv.pipe(createWriteStream(path));
  const done = finished(out);
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
    csv.destroy();
    await done.catch(() => undefined);
    await rm(path, { force: true });
    if ((error as { code?: string }).code === 'ENOSPC') throw new ExportTooLarge(`${def.kind}: the export volume is full`);
    throw error;
  }
}

/** The person's own export, or not_found: an export is only ever its starter's. */
async function ownExport(ctx: Ctx, id: string) {
  const [row] = await platformTx(ctx).select({ id: dataExports.id, kind: dataExports.kind, status: dataExports.status,
    rows: dataExports.rows, storeKey: dataExports.storeKey, failure: dataExports.failure }).from(dataExports)
    .where(and(eq(dataExports.id, id), eq(dataExports.createdBy, principalId(ctx.principal)))).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such export');
  return row;
}

/** getExport: the status of the person's own export. */
export async function exportStatus(ctx: Ctx, input: z.output<typeof getExport.input>,
): Promise<z.input<typeof getExport.output>> {
  const row = await ownExport(ctx, input.id);
  const failure = row.failure === 'too_large' || row.failure === 'failed' ? row.failure : null;
  return { status: row.status === 'ready' || row.status === 'failed' ? row.status : 'queued', rows: row.rows, failure };
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
