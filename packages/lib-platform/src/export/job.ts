// Exports wired (RAD-47 part 2, ADR-001 §8b, the architect on RAD-47). A module's library declares its exports once,
// `export const salesExports = [exportOf(c.exportInvoices, invoiceExportRows)]`; the API's route file spreads
// `...defineExport(sales.salesExports)` for their start routes, and the worker's job file has
// `defineExportJob([...sales.salesExports, ...])`, the one `platform.export` job that runs them all, one at a time.
// The job reads in one read-only `repeatable read` snapshot as the person who started it, their export permission
// checked again; it uploads after commit, then marks the export ready and records the `export` event (RC-031).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataExports, platformTx } from '@radcore/db/platform';
import { idString, type PiiKind } from '@radcore/lib-common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { principalId, type Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { defineJob, type JobDefinition } from '../jobs.ts';
import { defineRoute, type Route } from '../route.ts';
import { recordSecurityEvent } from '../security-events.ts';
import { EXPORT_MAX_ROWS, mastersExport, type ExportContract, type WorkbookContract } from './contract.ts';
import { ExportTooLarge, queuedExport, writeExportFile, writeWorkbookFile, type ExportRows, type ExportSheet } from './engine.ts';

/** A module's export, ready to wire: its contract with the module's row function. */
export type ModuleExport = {
  readonly kind: string;
  readonly perm: string;
  readonly start: ExportContract['start'];
  /** Its columns holding personal data (RAD-40). */
  readonly pii: Readonly<Partial<Record<string, PiiKind>>>;
  /** Its file's format: a list's CSV, or a workbook's XLSX (RAD-92). */
  readonly format: 'csv' | 'xlsx';
  /** Writes every row for a stored filter to `path`, the filter checked by the list's own schema first. */
  readonly write: (ctx: Ctx, filter: unknown, path: string, cap: number) => Promise<number>;
};

/** A module's export: its contract and the function that gives its rows a page at a time (ADR-001 §8b). */
export function exportOf<F extends z.ZodType>(contract: ExportContract<F>, rows: ExportRows<z.output<F>>): ModuleExport {
  const def = { kind: contract.kind, columns: contract.columns, rows, pii: contract.pii };
  return Object.freeze({
    kind: contract.kind, perm: contract.perm, start: contract.start, pii: contract.pii, format: contract.format,
    write: (ctx: Ctx, filter: unknown, path: string, cap: number) => writeExportFile(ctx, def, contract.filter.parse(filter), path, cap),
  });
}

/** A workbook export (RAD-92): its contract with the modules' sheets, joined in the worker's job file, the one place
 * that may import every module. Each sheet goes in only when the starter holds its key when the job runs. */
export function workbookOf<F extends z.ZodType>(contract: WorkbookContract<F>, sheets: readonly ExportSheet<z.output<F>>[]): ModuleExport {
  const names = new Set(sheets.map((s) => s.name));
  if (names.size !== sheets.length) throw new Error(`${contract.kind}: two sheets share a name`);
  return Object.freeze({
    kind: contract.kind, perm: contract.perm, start: contract.start, pii: {}, format: contract.format,
    write: (ctx: Ctx, filter: unknown, path: string, cap: number) =>
      writeWorkbookFile(ctx, sheets, contract.filter.parse(filter), path, cap),
  });
}

/** What the API's start route needs of an export: its kind, its route and its format, never its rows. */
type Startable = Pick<ModuleExport, 'kind' | 'start' | 'format'>;
const CONTENT_TYPE = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

const EXPORT_JOB = { name: 'platform.export', input: z.object({ exportId: idString(), kind: z.string() }) } as const;
/** Each page's query may take this long; the snapshot holds across them (ADR-002 Exports). */
const PAGE_TIMEOUT_MS = 60_000;
/** A whole export, a million rows at most, finishes within this. */
const EXPORT_TIMEOUT_SECONDS = 3_600;

/**
 * Starts an export: its row, then its job through the outbox, in the request's transaction; answers at once. Exports
 * run one at a time for everyone, so a person has one queued at a time: another start is export_in_progress.
 * shortcut: two starts in the same instant can both pass the check; add a partial unique index if that ever matters.
 */
async function startExport(ctx: Ctx, m: Startable, filter: unknown): Promise<{ exportId: string }> {
  if (await queuedExport(ctx)) throw new AppError('export_in_progress', 'Your last export is still being made. Try again when it is ready.');
  const [row] = await platformTx(ctx).insert(dataExports).values({ kind: m.kind, filter, format: m.format }).returning({ id: dataExports.id });
  if (row === undefined) throw new Error(`${m.kind}: the export wasn't saved`);
  await ctx.jobs.send(EXPORT_JOB, { exportId: row.id, kind: m.kind });
  return { exportId: row.id };
}

/** Each export's start route, `POST /<module>/<name>/exports`, for the API's route file. */
export const defineExport = (exports: readonly Startable[]): Route[] =>
  exports.map((m) => defineRoute(m.start, (ctx, input) => startExport(ctx, m, input.filter)));

/** The masters workbook's start (RAD-92): its contract alone, since its sheets are joined in the worker. The API's route
 * file mounts it with `defineRoute(contract.mastersExport.start, startMastersExport)`. */
export const startMastersExport = (ctx: Ctx, input: z.output<typeof mastersExport.start.input>) =>
  startExport(ctx, mastersExport, input.filter);

type Written =
  | { exportId: string; kind: string; skip: true }
  | { exportId: string; kind: string; skip: false; dir: string; path: string; rows: number; format: 'csv' | 'xlsx' }
  | { exportId: string; kind: string; skip: false; failure: 'too_large' | 'failed'; error?: unknown };

const setFailed = (failure: 'too_large' | 'failed', exportId: string) => async (ctx: Ctx) => {
  await platformTx(ctx).update(dataExports).set({ status: 'failed', failure }).where(eq(dataExports.id, exportId));
};

/**
 * The one `platform.export` job, for the worker's job file. Each kind is declared once: a duplicate refuses to start.
 * An unknown kind fails the job, with no fallback permission. `cap` is EXPORT_MAX_ROWS; tests pass a small one.
 */
export function defineExportJob(exports: readonly ModuleExport[], { cap = EXPORT_MAX_ROWS }: { cap?: number } = {}): JobDefinition {
  const byKind = new Map<string, ModuleExport>();
  for (const m of exports) {
    if (byKind.has(m.kind)) throw new Error(`export ${m.kind} is declared twice`);
    byKind.set(m.kind, m);
  }
  const find = (kind: string): ModuleExport => {
    const m = byKind.get(kind);
    if (m === undefined) throw new Error(`no export of kind ${kind}`);
    return m;
  };
  return defineJob({
    name: EXPORT_JOB.name, input: EXPORT_JOB.input,
    principal: { kind: 'user', perm: (input) => find(input.kind).perm },
    tx: { readOnly: true, isolation: 'repeatable read', statementTimeoutMs: PAGE_TIMEOUT_MS },
    // One at a time, so a single file fills the size-limited volume; a failed export is started again, not retried.
    oneAtATime: true, retries: 0, timeoutSeconds: EXPORT_TIMEOUT_SECONDS,
  }, async (ctx, { exportId, kind }): Promise<Written> => {
    const m = find(kind);
    const [row] = await platformTx(ctx).select({ status: dataExports.status, filter: dataExports.filter,
      createdBy: dataExports.createdBy }).from(dataExports)
      .where(and(eq(dataExports.id, exportId), eq(dataExports.kind, kind))).limit(1);
    // Only its starter's, and only once: a stray or repeated job does nothing.
    if (row === undefined || row.status !== 'queued' || row.createdBy !== principalId(ctx.principal)) {
      return { exportId, kind, skip: true };
    }
    // shortcut: the worker's temp directory is the export volume (ADR-004 §2 mounts it size-limited); give the export
    // its own setting if the two ever need to differ.
    const dir = await mkdtemp(join(tmpdir(), 'radcore-export-'));
    const path = join(dir, `${kind}.${m.format}`);
    try {
      return { exportId, kind, skip: false, dir, path, rows: await m.write(ctx, row.filter, path, cap), format: m.format };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      return error instanceof ExportTooLarge ? { exportId, kind, skip: false, failure: 'too_large' }
        : { exportId, kind, skip: false, failure: 'failed', error };
    }
  }, {
    // After the snapshot commits: the upload, then the row marked, in a second short transaction (ADR-001 §8).
    afterCommit: async (done, again, { files }) => {
      if (done.skip) return;
      if ('failure' in done) {
        await again(setFailed(done.failure, done.exportId));
        // too_large is the export's answer; anything else also fails the job, for the dead-letter alert.
        if (done.error !== undefined) throw done.error;
        return;
      }
      try {
        const { key } = await files.putFile('export', done.path, CONTENT_TYPE[done.format]);
        await again(async (ctx) => {
          await platformTx(ctx).update(dataExports).set({ status: 'ready', rows: done.rows, storeKey: key })
            .where(eq(dataExports.id, done.exportId));
          await recordSecurityEvent(ctx, { kind: 'export', detail: { what: done.kind, rows: done.rows } },
            { userId: ctx.principal.kind === 'user' ? ctx.principal.userId : null, device: null });
        });
      } catch (error) {
        await again(setFailed('failed', done.exportId));
        throw error;
      } finally {
        await rm(done.dir, { recursive: true, force: true });
      }
    },
  });
}
