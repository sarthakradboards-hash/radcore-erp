// The schema and the transaction opener (ADR-001 §5, ADR-002 §4). Only lib-platform imports this entry (D7): it builds
// the Drizzle client on its pool from SCHEMA (db/client.ts), and its runtime entry, which only the apps import (L7),
// is the one place a transaction opens.
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as platform from './platform/tables.ts';
import * as stock from './stock/tables.ts';
import { applyRequestContext, type RequestContext } from './request-context.ts';
import { bind, unbind, type RawTx, type Tx } from './tx.ts';

export type { Tx } from './tx.ts';
// Every table, for tools/schema.test.ts's guard and drizzle-kit's snapshots.
export * from './platform/tables.ts';
export * from './stock/tables.ts';

/** Every module's tables and relations, as they land: the same files drizzle.config.ts lists. */
export const SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({ ...platform, ...stock });

/** The Drizzle client lib-platform builds on its pool. */
export type Database = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** A contract's `tx` (ADR-002 §4). */
export type TxSpec = {
  readOnly: boolean;
  isolation: 'read committed' | 'repeatable read';
  statementTimeoutMs?: number | undefined;
};

// shortcut: a fixed ceiling for a contract's own statement timeout; make it a setting if an export ever needs more.
export const MAX_STATEMENT_TIMEOUT_MS = 300_000;

function check(spec: TxSpec): void {
  const ms = spec.statementTimeoutMs;
  // 0 would switch the timeout off (RC-080).
  if (ms !== undefined && !(Number.isInteger(ms) && ms > 0 && ms <= MAX_STATEMENT_TIMEOUT_MS)) {
    throw new TypeError(`statementTimeoutMs must be a whole number from 1 to ${MAX_STATEMENT_TIMEOUT_MS}`);
  }
  if (!spec.readOnly && spec.isolation !== 'read committed') throw new TypeError('A write is read committed');
}

/**
 * Runs `fn` in one transaction: the contract's access mode and isolation, the request context and statement timeout
 * set first, and `fn` given only the opaque handle. It commits when `fn` resolves and rolls back when it throws; the
 * handle is dead afterwards either way.
 */
export async function openTransaction<R>(db: Database, spec: TxSpec, who: Omit<RequestContext, 'statementTimeoutMs'>,
  fn: (tx: Tx) => Promise<R>): Promise<R> {
  check(spec);
  return db.transaction(async (raw) => {
    await applyRequestContext(raw as unknown as RawTx, { ...who, statementTimeoutMs: spec.statementTimeoutMs });
    const handle = bind(raw as unknown as RawTx);
    try {
      return await fn(handle);
    } finally {
      unbind(handle);
    }
  }, { isolationLevel: spec.isolation, accessMode: spec.readOnly ? 'read only' : 'read write' });
}
