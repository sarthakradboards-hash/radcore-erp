// The database pool and the job queue (ADR-002 L4's one place for the driver and pg-boss) and the health ping.
// RAD-28 builds the pool; RAD-26 builds the Drizzle client on it. RAD-44 builds the queue.
import { SCHEMA, type Database as Drizzle } from '@radcore/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { RateLimiterPostgres, RateLimiterRes } from 'rate-limiter-flexible';
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
 * The Drizzle client on the pool (RAD-26), with every module's tables and relations. Transactions open on it through
 * the runtime entry only. The schema argument is for tests with tables of their own.
 */
export function createDatabase(pool: pg.Pool, schema: Readonly<Record<string, unknown>> = SCHEMA): Drizzle {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
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

/** One use of the shared store: a key prefix, how many points a key gets per window, and how long a key that used
 * them all is held. */
type LimitSpec = { prefix: string; points: number; windowSeconds: number; blockSeconds: number };

/** Counts uses per key. Each answer is how many seconds the key must wait, 0 when it may go now. */
export type Limiter = {
  wait(key: string): Promise<number>;
  /** Counts one use and answers the wait after it. */
  hit(key: string): Promise<number>;
  reset(key: string): Promise<void>;
};

export type LimiterStore = { limiter(spec: LimitSpec): Limiter; end(): Promise<void> };

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * The shared rate-limit store (ADR-003, RAD-32): rate-limiter-flexible on PostgreSQL, in `ratelimit.limits` (migration
 * 0007), on its own pool of 2 (ADR-004's connection budget). It fails closed: when the store can't be reached, every
 * answer is the whole block, so a limited action is refused. RAD-39 builds its per-IP limits on the same store.
 */
export function createLimiterStore(db: Database, log: Logger): LimiterStore {
  const pool = new pg.Pool({ ...connection(db), max: 2 });
  pool.on('error', (err) => log.error('rate-limit store connection lost; the pool will reconnect', err));
  return {
    limiter({ prefix, points, windowSeconds, blockSeconds }: LimitSpec): Limiter {
      const rl = new RateLimiterPostgres({ storeClient: pool, schemaName: 'ratelimit', tableName: 'limits',
        tableCreated: true, keyPrefix: prefix, points, duration: windowSeconds, blockDuration: blockSeconds });
      const closed = (err: unknown): number => {
        log.error(`rate-limit store did not answer for ${prefix}; refusing (fails closed)`, err);
        return blockSeconds;
      };
      return {
        async wait(key) {
          try {
            const res = await rl.get(key);
            return res !== null && res.consumedPoints > points ? seconds(res.msBeforeNext) : 0;
          } catch (err) {
            return closed(err);
          }
        },
        async hit(key) {
          try {
            await rl.consume(key);
            return 0;
          } catch (err) {
            return err instanceof RateLimiterRes ? seconds(err.msBeforeNext) : closed(err);
          }
        },
        async reset(key) {
          await rl.delete(key);
        },
      };
    },
    end: () => pool.end(),
  };
}
