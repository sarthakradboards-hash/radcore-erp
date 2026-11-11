// What every service gets (ADR-001 §5, §6a, RAD-26): the request's opaque transaction, who it runs as, its id, and
// the settings.
// `ctx.tx` has no members, so a service can only hand it to its own module transaction (`salesTx(ctx)`) (T1).
import type { Tx } from '@radcore/db/schema';
import type { z } from 'zod';
import type { FileStore } from './files/store.ts';
import type { Settings } from './settings.ts';

/** Who a request or job runs as (ADR-001 §6a). Link principals arrive with M1-23. */
export type Principal =
  | { readonly kind: 'user'; readonly userId: string; readonly permissions: readonly string[] }
  | { readonly kind: 'system'; readonly name: string; readonly permissions: readonly string[] };

/** What send needs of a job contract (jobs.ts's JobContract has it); named here so ctx.ts imports no jobs.ts (D1). */
type QueuedJob<I> = { readonly name: string; readonly input: z.ZodType<I> };

/** Queues jobs in the caller's transaction, through the outbox (ADR-002 §4): a save that rolls back queues nothing. */
export type Jobs = {
  /** Checks input against the job's own schema now, so a bad payload fails the save, not the job later. */
  send<I>(job: QueuedJob<I>, input: I): Promise<void>;
};

/**
 * The file store's two signing calls (RAD-43, ADR-001 §8): they sign locally and send nothing, so they're safe inside a
 * transaction. Checking an upload and the server's own put reach S3, so they run outside one (a job, or after commit).
 */
export type Files = Pick<FileStore, 'presignUpload' | 'downloadUrl'>;

export type Ctx = {
  readonly tx: Tx;
  readonly principal: Principal;
  /** Logged with every line about this request, and recorded on audit rows. */
  readonly requestId: string;
  /** Every setting, read once when this Ctx was built (RAD-48): `ctx.settings.get(def)`. */
  readonly settings: Settings;
  /** `ctx.jobs.send(contract, input)`: the job runs after this transaction commits, never if it rolls back. */
  readonly jobs: Jobs;
  /** `ctx.files.presignUpload(kind, type)` and `ctx.files.downloadUrl(key, name)`: links, never bytes. */
  readonly files: Files;
};

/** How audit rows and `app.principal` name a principal: `user:<id>` or `system:<name>`. */
export const principalId = (p: Principal): string => (p.kind === 'user' ? `user:${p.userId}` : `system:${p.name}`);
