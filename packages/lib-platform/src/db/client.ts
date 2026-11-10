// The database pool and the job queue (ADR-002 L4's one place for the driver and pg-boss) and the health ping.
// RAD-28 builds the pool; RAD-26 opens transactions on it. RAD-44 builds the queue.
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';

type Database = Config['database'];
/** The pool's type, so nothing else needs to import the driver (L4). */
export type Pool = pg.Pool;
/** The queue's type, so nothing else imports pg-boss (L4). */
export type JobQueue = PgBoss;
/** pg-boss's own tables live in this schema, created by an owner migration (ADR-002 §4), never by the app. */
const JOB_QUEUE_SCHEMA = 'pgboss';

/**
 * The job queue on its own pool of 4 (ADR-004 §2's connection budget), with the same three timeouts. It never
 * creates or migrates its schema, and never rebuilds an index: the runtime login has no DDL and owns no index
 * (ADR-005, RAD-24). Rebuilding pg-boss's job indexes is an owner task.
 */
export function createJobQueue(db: Database, log: Logger): JobQueue {
  const boss = new PgBoss({
    connectionString: db.url, max: 4, connectionTimeoutMillis: db.poolWaitMs, schema: JOB_QUEUE_SCHEMA,
    // Options the URL carries are kept, as the pool keeps them (the tests run as the app login with `-c role=`).
    options: [new URL(db.url).searchParams.get('options'), `-c statement_timeout=${db.statementTimeoutMs}`,
      `-c lock_timeout=${db.lockTimeoutMs}`, `-c idle_in_transaction_session_timeout=${db.idleTxTimeoutMs}`]
      .filter(Boolean).join(' '),
    migrate: false, createSchema: false, reindex: false,
  });
  // RC-078: without a listener, pg-boss's 'error' event (a lost connection, a failed poll) would end the process.
  boss.on('error', (err) => log.error('job queue error; it retries on its next poll', err));
  return boss;
}

const connection = (db: Database) => ({
  connectionString: db.url,
  connectionTimeoutMillis: db.poolWaitMs,
  // ADR-002 §4: every connection carries the three timeouts, so no statement, lock wait or idle transaction is endless.
  statement_timeout: db.statementTimeoutMs,
  lock_timeout: db.lockTimeoutMs,
  idle_in_transaction_session_timeout: db.idleTxTimeoutMs,
});

export function createPool(db: Database, log: Logger): pg.Pool {
  const pool = new pg.Pool({ ...connection(db), max: db.poolMax });
  // RC-078: an idle connection dropped by a database restart is reported here. Without a listener, Node would end
  // the process; with one, the pool discards that connection and opens a new one on next use.
  pool.on('error', (err) => log.error('database connection lost; the pool will reconnect', err));
  return pool;
}

/**
 * Proves the database answers: opens a new connection (TLS, authentication, startup) and closes it. A pooled idle
 * connection could look alive after the database went away, so the ping never borrows one. No SQL is sent (L2, L3).
 */
export async function ping(db: Database): Promise<void> {
  const client = new pg.Client(connection(db));
  // A failed connect emits 'error' as well as rejecting; the rejection is what the caller handles.
  client.on('error', () => undefined);
  try {
    await client.connect();
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The health check: one ping at a time, its result (success or failure) reused for `ttlMs` after it settles. A burst
 * of /health requests therefore opens at most one connection per `ttlMs`, whatever the request rate.
 */
export function createHealthCheck(db: Database,
  { ttlMs = 1500, now = () => performance.now(), probe = ping }: { ttlMs?: number; now?: () => number;
    probe?: (db: Database) => Promise<void> } = {},
): () => Promise<void> {
  let pending: Promise<void> | null = null;
  let last: Promise<void> | null = null;
  let settledAt = 0;
  return () => {
    if (pending !== null) return pending;
    if (last !== null && now() - settledAt < ttlMs) return last;
    const run = probe(db).finally(() => {
      settledAt = now();
      pending = null;
    });
    pending = run;
    last = run;
    return run;
  };
}
