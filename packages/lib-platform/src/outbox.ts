// The outbox relay (ADR-002 §4, RAD-44): hands jobs queued by `ctx.jobs.send` to pg-boss once their transaction has
// committed. Each pass runs in one transaction:
// - it takes the live rows that are due, oldest due first, `FOR UPDATE SKIP LOCKED`, so two workers never take the
//   same row;
// - it sends each to pg-boss with pg-boss's job id set to the row's id, and deletes the rows it sent;
// - a row pg-boss won't take (its queue isn't set up, say) is tried again later, backing off, and after its last try
//   is set aside with an alert. So a bad row never blocks the jobs behind it.
// A crash between the send and the delete leaves the row, and the next pass sends it again under the same id, which
// pg-boss refuses: the job is queued once. There is no ordering guarantee; every job handler is idempotent.
import { randomUUID } from 'node:crypto';
import { jobsOutbox, platformTx } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { and, asc, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { createAlerter, type Alerter } from './alerts.ts';
import type { Ctx, Principal } from './ctx.ts';
import type { JobQueue } from './db/client.ts';
import type { JobContract, JobEnvelope } from './jobs.ts';
import { runInTransaction } from './db/transaction.ts';
import type { Logger } from './log.ts';

const RELAY: Principal = Object.freeze({ kind: 'system', name: 'outbox-relay', permissions: Object.freeze([]) });
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
/** Rows taken per pass; a full pass is followed at once by another. */
const OUTBOX_BATCH = 100;
/** Tries before a row is set aside: with the backoff below, about 8.5 minutes in all. */
const MAX_ATTEMPTS = 10;
/** Wait before the next try: 1 s, doubling, at most an hour. */
const backoffMs = (attempts: number): number => Math.min(1000 * 2 ** (attempts - 1), 3_600_000);

export type RelayOptions = {
  batch?: number;
  maxAttempts?: number;
  /** For tests: the wait before try `attempts + 1`. */
  backoff?: (attempts: number) => number;
  /** Raised once for each row set aside. Log-only by default. */
  alert?: Alerter;
  /** Only rows of these jobs. Left out, every due row: the worker's relay. A test passes its own jobs' names, because
   * the outbox is shared by every test file running at once, and a pass over all of it would try their rows (RAD-79). */
  only?: readonly string[];
};

/** One pass. `taken` is how many due rows it looked at; `sent`, how many reached pg-boss. */
export async function relayOutbox(db: Database, queue: JobQueue, log: Logger, options: RelayOptions = {},
): Promise<{ taken: number; sent: number }> {
  const { batch = OUTBOX_BATCH, maxAttempts = MAX_ATTEMPTS, backoff = backoffMs, alert = createAlerter(null, log), only } = options;
  const setAside: { id: string; name: string }[] = [];
  const result = await runInTransaction(db, WRITE, RELAY, randomUUID(), async (ctx) => {
    const tx = platformTx(ctx);
    const now = new Date();
    const rows = await tx.select({ id: jobsOutbox.id, name: jobsOutbox.name, data: jobsOutbox.data,
      principal: jobsOutbox.principal, attempts: jobsOutbox.attempts })
      .from(jobsOutbox).where(and(isNull(jobsOutbox.deadAt), lte(jobsOutbox.nextAttemptAt, now),
        only === undefined ? undefined : inArray(jobsOutbox.name, [...only])))
      .orderBy(asc(jobsOutbox.nextAttemptAt)).limit(batch).for('update', { skipLocked: true });
    const sent: string[] = [];
    for (const row of rows) {
      try {
        // The enqueuer travels with the job, so it runs as them (ADR-001 §6a).
        const envelope: JobEnvelope = { input: row.data, by: row.principal };
        await queue.send(row.name, envelope, { id: row.id });
        sent.push(row.id);
      } catch (err) {
        const attempts = row.attempts + 1;
        const last = attempts >= maxAttempts;
        await tx.update(jobsOutbox).set(last ? { attempts, deadAt: now }
          : { attempts, nextAttemptAt: new Date(now.getTime() + backoff(attempts)) }).where(eq(jobsOutbox.id, row.id));
        if (attempts === 1) log.error(`outbox: job ${row.name} (row ${row.id}) could not be queued; trying again later`, err);
        if (last) setAside.push({ id: row.id, name: row.name });
      }
    }
    if (sent.length > 0) await tx.delete(jobsOutbox).where(inArray(jobsOutbox.id, sent));
    return { taken: rows.length, sent: sent.length };
  });
  // After commit, so an alert never names a row whose setting aside rolled back.
  for (const row of setAside) {
    await alert(`outbox: job ${row.name} (row ${row.id}) could not be queued after ${maxAttempts} tries; it is set aside`);
  }
  return result;
}

/** Runs a pass every `everyMs` (one at a time) until stopped; stopping waits for the pass in flight. */
export function startOutboxRelay(db: Database, queue: JobQueue, log: Logger,
  { everyMs = 1000, alert }: { everyMs?: number; alert?: Alerter } = {}): { name: string; stop(): Promise<void> } {
  const options: RelayOptions = alert === undefined ? {} : { alert };
  const state: { pass: Promise<void> | null } = { pass: null };
  const run = async (): Promise<void> => {
    try {
      while ((await relayOutbox(db, queue, log, options)).taken === OUTBOX_BATCH) { /* a full batch: more may be due */ }
    } catch (err) {
      log.error('outbox: a relay pass failed; the next one retries', err);
    }
  };
  const timer = setInterval(() => {
    state.pass ??= run().finally(() => { state.pass = null; });
  }, everyMs);
  timer.unref();
  return { name: 'outbox relay', stop: async () => {
    clearInterval(timer);
    await state.pass;
  } };
}

/** How long a set-aside row is kept for someone to look into before the clean-up deletes it: payloads may be personal. */
const SET_ASIDE_KEEP_MS = 30 * 86_400_000;

/** Deletes set-aside outbox rows past their keep (auditor-2, RAD-44). Daily, one run at a time, as a system principal. */
export const outboxCleanup: JobContract<object | null> = {
  name: 'platform.outbox-cleanup',
  principal: { kind: 'system', name: 'outbox-cleanup', permissions: [] },
  input: z.strictObject({}).nullable(),
  every: '41 3 * * *',
  oneAtATime: true,
};

export async function cleanOutbox(ctx: Ctx): Promise<void> {
  await platformTx(ctx).delete(jobsOutbox).where(lt(jobsOutbox.deadAt, new Date(Date.now() - SET_ASIDE_KEEP_MS)));
}