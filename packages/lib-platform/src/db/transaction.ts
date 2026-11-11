// The one transaction opener the apps use (ADR-002 §4): the generic route handler and the job runner call it, and
// nothing else can, because only the runtime entry exports it (L7).
import { jobsOutbox, platformTx, settings as settingsTable } from '@radcore/db/platform';
import { openTransaction, type Database, type TxSpec } from '@radcore/db/schema';
import { principalId, type Ctx, type Files, type Jobs, type Principal } from '../ctx.ts';
import { Settings } from '../settings.ts';

/**
 * Runs `fn` with a Ctx in one transaction of the contract's kind, as `principal`. The settings are read once, first,
 * in the same transaction, so the whole request sees one version of them (RAD-48).
 */
// A process built without a file store (a test, the relay) gets a ctx.files that says so, rather than no member.
const noStore = (): Promise<never> => Promise.reject(new Error('this process has no file store (RAD-43)'));
const NO_FILES: Files = Object.freeze({ presignUpload: noStore, downloadUrl: noStore });

export function runInTransaction<R>(db: Database, spec: TxSpec, principal: Principal, requestId: string,
  fn: (ctx: Ctx) => Promise<R>, store?: Files): Promise<R> {
  // Each process builds its store once from config.s3 (the api and worker mains) and passes it here (ADR-001 §8).
  const files: Files = store === undefined ? NO_FILES
    : Object.freeze({ presignUpload: store.presignUpload, downloadUrl: store.downloadUrl });
  return openTransaction(db, spec, { principal: principalId(principal), requestId }, async (tx) => {
    const rows = await platformTx({ tx }).select({ key: settingsTable.key, value: settingsTable.value }).from(settingsTable);
    // The outbox row is written with the request's own transaction: it commits or rolls back with the save.
    const jobs: Jobs = Object.freeze({
      send: async (job, input) => {
        await platformTx({ tx }).insert(jobsOutbox).values({ name: job.name, data: job.input.parse(input),
          principal: principalId(principal), requestId });
      },
    });
    return fn(Object.freeze({ tx, principal, requestId, settings: new Settings(rows), jobs, files }));
  });
}
