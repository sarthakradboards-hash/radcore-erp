// Background jobs declared as data (RAD-44, ADR-001 §8, RC-082): each job contract names its queue, its principal
// (ADR-001 §6a), its input schema, and how it retries, times out, overlaps and is kept. The worker runs them on
// pg-boss (runtime.ts). Jobs are declared in apps/worker/src/jobs/ with defineJob(contract, service), like routes.
import type { z } from 'zod';

/** Who a job runs as (ADR-001 §6a). Enforced through Ctx once M1-08 lands; declared on every job now. */
export type JobPrincipal =
  /** A schedule or webhook: every record, but only these permissions. */
  | { kind: 'system'; name: string; permissions: readonly string[] }
  /** Queued during a person's request: their permissions, checked again when the job runs. */
  | { kind: 'user' };

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

export type JobMeta = { jobId: string; principal: JobPrincipal };

/** A job contract with the service that does the work. The worker runs these; nothing else calls `handle`. */
export type JobDefinition = {
  name: string;
  principal: JobPrincipal;
  every: string | null;
  deleteOnComplete: boolean;
  settings: QueueSettings;
  /** Checks the payload against the contract's input schema, then runs the service. */
  handle(data: unknown, jobId: string): Promise<void>;
};

/** What pg-boss gets for the queue (its Queue options). */
export type QueueSettings = {
  policy: 'standard' | 'singleton';
  retryLimit: number;
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
    retryLimit: wholeNumber(c.retries ?? 3, 0, `${c.name}: retries`),
    retryDelay: wholeNumber(c.retryDelaySeconds ?? 30, 1, `${c.name}: retryDelaySeconds`),
    retryBackoff: true,
    expireInSeconds: wholeNumber(c.timeoutSeconds ?? 300, 1, `${c.name}: timeoutSeconds`),
    // pg-boss's clean-up deletes completed and failed jobs this long after they finish; 0 would mean never.
    deleteAfterSeconds: c.deleteOnComplete === true ? 1 : 7 * DAY,
    // A job that fails all its attempts goes here, and the worker raises the dead-letter alert.
    deadLetter: `${c.name}.dead`,
  };
}

export function defineJob<I>(contract: JobContract<I>, service: (input: I, meta: JobMeta) => Promise<void>): JobDefinition {
  const settings = queueSettings(contract);
  return {
    name: contract.name,
    principal: contract.principal,
    every: contract.every ?? null,
    deleteOnComplete: contract.deleteOnComplete === true,
    settings,
    // shortcut: runs the service with the principal as data; M1-08 builds Ctx and rechecks the enqueuer's permissions.
    handle: async (data, jobId) => service(contract.input.parse(data), { jobId, principal: contract.principal }),
  };
}
