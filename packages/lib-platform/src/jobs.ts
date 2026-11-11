// Background jobs declared as data (RAD-44, ADR-001 §8, RC-082): each job contract names its queue, its principal
// (ADR-001 §6a), its input schema, and how it retries, times out, overlaps and is kept. The worker runs them on
// pg-boss (runtime.ts). Jobs are declared in apps/worker/src/jobs/ with defineJob(contract, service), like routes.
import { z } from 'zod';
import type { Alerter } from './alerts.ts';
import type { Ctx, Principal } from './ctx.ts';
import type { FileStore } from './files/store.ts';

/** Who a job runs as (ADR-001 §6a): its service gets a Ctx for that principal (RAD-44 step 3). */
export type JobPrincipal =
  /** A schedule or webhook: every record, but only these permissions. */
  | { kind: 'system'; name: string; permissions: readonly string[] }
  /** Queued during a person's request: run as that person, with this permission checked again when it runs. */
  | { kind: 'user'; perm: string };

export type JobContract<I> = {
  /** Queue name: lower-case words joined by dots or hyphens, like `sales.shopify-order`. */
  name: string;
  principal: JobPrincipal;
  input: z.ZodType<I>;
  /** Attempts after the first. Default 3. */
  retries?: number;
  /** First wait before a retry, doubling each time. Default 30 seconds. */
  retryDelaySeconds?: number;
  /** An attempt still running after this fails and is retried. Default 300 seconds. */
  timeoutSeconds?: number;
  /** Overlap guard: at most one attempt runs at a time, however many are queued. */
  oneAtATime?: boolean;
  /** Run on this cron schedule (five fields, so at most once a minute). */
  every?: string;
  /**
   * Delete the job row, payload and all, as soon as it completes, and keep failed ones only until the next clean-up
   * (seconds). For payloads that must not stay in the database, such as a password-reset link (RAD-32).
   */
  deleteOnComplete?: boolean;
};

/** What a job's service gets beside its Ctx and input: its id, and the worker's alerter (RAD-65), for work whose result is an alert. */
export type JobMeta = { jobId: string; alert: Alerter };

/** What pg-boss holds for every job: its input and who queued it (`user:<id>` or `system:<name>`, ADR-001 §6a). */
export type JobEnvelope = { input: unknown; by: string };
const ENVELOPE = z.object({ input: z.unknown(), by: z.string().min(1) });

/** The person a job was queued by, as they are now: null when they're gone (RAD-35 provides it; until then, null). */
export type LoadPrincipal = (by: string) => Promise<Principal | null>;

/** A job that can't run as its enqueuer: they're gone, or no longer hold its permission. It isn't retried. */
export class JobRefused extends Error {
  override name = 'JobRefused';
}

/** How the worker runs a job's service: in one transaction, with a Ctx for principal (runtime.ts). */
export type OpenJob = (principal: Principal, jobId: string, work: (ctx: Ctx) => Promise<void>) => Promise<void>;

/** What the worker gives a job to run with: its transaction, how to load the enqueuer, the alerter, and the file
 * store when the process has one (RAD-43). */
type JobRun = { open: OpenJob; load: LoadPrincipal; alert: Alerter; files?: FileStore };

/** Work a job does before its transaction opens, because it reaches the network (ADR-001 §8): checking an upload in
 * S3, say. Its result reaches the service as `meta.before`. */
export type BeforeJob<I, B> = (input: I, outside: { files: FileStore }) => Promise<B>;

/** A job contract with the service that does the work. The worker runs these; nothing else calls `handle`. */
export type JobDefinition = {
  name: string;
  principal: JobPrincipal;
  every: string | null;
  deleteOnComplete: boolean;
  settings: QueueSettings;
  /** Checks the envelope and its input, settles who the job runs as, then runs the service through open. */
  handle(data: unknown, jobId: string, run: JobRun): Promise<void>;
};

/** What pg-boss gets for the queue (its Queue options). */
export type QueueSettings = {
  policy: 'standard' | 'singleton';
  /** Attempts after the first (pg-boss's retryLimit). */
  retries: number;
  retryDelay: number;
  retryBackoff: true;
  expireInSeconds: number;
  deleteAfterSeconds: number;
  deadLetter: string;
};

const NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const DAY = 86_400;
const wholeNumber = (value: number, min: number, what: string): number => {
  if (!Number.isInteger(value) || value < min) throw new Error(`${what} must be a whole number of at least ${min}`);
  return value;
};

/** The queue settings a contract asks for, checked. Exported for its tests. */
export function queueSettings(c: JobContract<unknown>): QueueSettings {
  if (!NAME.test(c.name) || c.name.endsWith('.dead')) throw new Error(`job name ${JSON.stringify(c.name)} is not valid`);
  return {
    policy: c.oneAtATime === true ? 'singleton' : 'standard',
    retries: wholeNumber(c.retries ?? 3, 0, `${c.name}: retries`),
    retryDelay: wholeNumber(c.retryDelaySeconds ?? 30, 1, `${c.name}: retryDelaySeconds`),
    retryBackoff: true,
    expireInSeconds: wholeNumber(c.timeoutSeconds ?? 300, 1, `${c.name}: timeoutSeconds`),
    // pg-boss's clean-up deletes completed and failed jobs this long after they finish; 0 would mean never.
    deleteAfterSeconds: c.deleteOnComplete === true ? 1 : 7 * DAY,
    // A job that fails all its attempts goes here, and the worker raises the dead-letter alert.
    deadLetter: `${c.name}.dead`,
  };
}

/**
 * The principal a job's Ctx runs as (ADR-001 §6a). A system job runs as its contract names it. A job for a user runs
 * as the person who queued it, loaded as they are now: if they're gone, or no longer hold the job's permission, it is
 * refused rather than run (a revoked permission fails the job, with the dead-letter alert).
 */
async function principalOf(name: string, p: JobPrincipal, by: string, load: LoadPrincipal): Promise<Principal> {
  if (p.kind === 'system') return Object.freeze({ kind: 'system', name: p.name, permissions: Object.freeze([...p.permissions]) });
  const who = by.startsWith('user:') ? await load(by) : null;
  if (who === null) throw new JobRefused(`${name}: queued by ${by}, who can't be loaded as a person now`);
  if (!who.permissions.includes(p.perm)) throw new JobRefused(`${name}: ${by} no longer holds ${p.perm}`);
  return who;
}
/** A job: its contract, its service, and optionally the network work it does first, outside the transaction. */
export function defineJob<I, B = undefined>(contract: JobContract<I>,
  service: (ctx: Ctx, input: I, meta: JobMeta & { before: B }) => Promise<void>, before?: BeforeJob<I, B>): JobDefinition {
  const settings = queueSettings(contract);
  // A schedule has no person behind it, so a scheduled job runs as a system principal.
  if (contract.every !== undefined && contract.principal.kind !== 'system') {
    throw new Error(`${contract.name}: a scheduled job must declare a system principal`);
  }
  return {
    name: contract.name,
    principal: contract.principal,
    every: contract.every ?? null,
    deleteOnComplete: contract.deleteOnComplete === true,
    settings,
    // The payload is checked before any transaction opens; the service's writes commit or roll back together.
    handle: async (data, jobId, { open, load, alert, files }) => {
      const { input: raw, by } = ENVELOPE.parse(data);
      const input = contract.input.parse(raw);
      const principal = await principalOf(contract.name, contract.principal, by, load);
      if (before !== undefined && files === undefined) throw new Error(`${contract.name}: this worker has no file store`);
      // Outside any transaction: no connection is held while it waits on the network.
      // Without a `before`, B is undefined, so this is B either way.
      const done = (before === undefined || files === undefined ? undefined : await before(input, { files })) as B;
      await open(principal, jobId, (ctx) => service(ctx, input, { jobId, alert, before: done }));
    },
  };
}
