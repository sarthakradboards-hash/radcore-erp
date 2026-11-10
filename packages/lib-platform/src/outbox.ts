// The outbox relay (ADR-002 §4, RAD-44): hands jobs queued by `ctx.jobs.send` to pg-boss once their transaction has
// committed. Each pass runs in one transaction:
// - it takes due rows `FOR UPDATE SKIP LOCKED`, so two workers never take the same row;
// - it sends each to pg-boss with pg-boss's job id set to the row's id;
// - it deletes the rows it sent.
// A crash between the send and the delete leaves the row, and the next pass sends it again under the same id, which
// pg-boss refuses: the job is queued once. There is no ordering guarantee; every job handler is idempotent.
import { randomUUID } from 'node:crypto';
import { jobsOutbox, platformTx } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { asc, inArray } from 'drizzle-orm';
import type { Principal } from './ctx.ts';
import type { JobQueue } from './db/client.ts';
import { runInTransaction } from './db/transaction.ts';
import type { Logger } from './log.ts';

const RELAY: Principal = Object.freeze({ kind: 'system', name: 'outbox-relay', permissions: Object.freeze([]) });
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
/** Rows handed on per pass; a full pass is followed at once by another. */
const OUTBOX_BATCH = 100;

/**
 * One pass. Returns how many rows were handed to pg-boss. A row pg-boss won't take (its queue isn't set up in this
 * worker) stays for a later pass and is logged once per process, through `reported`.
 */
export async function relayOutbox(db: Database, queue: JobQueue, log: Logger,
  { batch = OUTBOX_BATCH, reported = new Set<string>() }: { batch?: number; reported?: Set<string> } = {}): Promise<number> {
  return runInTransaction(db, WRITE, RELAY, randomUUID(), async (ctx) => {
    const tx = platformTx(ctx);
    const rows = await tx.select({ id: jobsOutbox.id, name: jobsOutbox.name, data: jobsOutbox.data }).from(jobsOutbox)
      .orderBy(asc(jobsOutbox.createdAt)).limit(batch).for('update', { skipLocked: true });
    const sent: string[] = [];
    for (const row of rows) {
      try {
        await queue.send(row.name, row.data as object, { id: row.id });
        sent.push(row.id);
      } catch (err) {
        if (!reported.has(row.id)) log.error(`outbox: job ${row.name} (row ${row.id}) could not be queued; it waits`, err);
        reported.add(row.id);
      }
    }
    if (sent.length > 0) await tx.delete(jobsOutbox).where(inArray(jobsOutbox.id, sent));
    return sent.length;
  });
}

/** Runs a pass every `everyMs` (one at a time) until stopped; stopping waits for the pass in flight. */
export function startOutboxRelay(db: Database, queue: JobQueue, log: Logger, { everyMs = 1000 }: { everyMs?: number } = {},
): { name: string; stop(): Promise<void> } {
  const reported = new Set<string>();
  const state: { pass: Promise<void> | null } = { pass: null };
  const run = async (): Promise<void> => {
    try {
      while ((await relayOutbox(db, queue, log, { reported })) === OUTBOX_BATCH) { /* a full batch: more may wait */ }
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
