// The database pool (ADR-002 L4's one place for the driver) and the health ping. RAD-28 builds the pool;
// RAD-26 opens transactions on it.
import pg from 'pg';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';

type Database = Config['database'];
/** The pool's type, so nothing else needs to import the driver (L4). */
export type Pool = pg.Pool;

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
