// The one helper run at the start of each transaction (ADR-002 §3, §4): the contract's isolation and access mode, who
// the work is for and which request it belongs to, for the audit triggers (ADR-005 §5), and the contract's statement
// timeout. Everything is set with set_config(..., true), so it lasts for this transaction only, and every value is a
// bound parameter.
import { sql } from 'drizzle-orm';
import type { RawTx } from './tx.ts';

export type RequestContext = {
  /** `user:<id>`, `system:<name>` or `link:<id>` (ADR-001 §6a). */
  principal: string;
  requestId: string;
  /** This transaction's statement timeout; without one, the connection's own stays. */
  statementTimeoutMs?: number | undefined;
};

/** A transaction's isolation and access mode: a write is read committed (schema.ts checks the contract's). */
export type TxStart = { readOnly: boolean; isolation: 'read committed' | 'repeatable read' };

export async function applyRequestContext(tx: RawTx, start: TxStart, c: RequestContext): Promise<void> {
  // The transaction's first statement, never its BEGIN: Drizzle 0.45.4 sends BEGIN before its try/finally, so a BEGIN
  // the database refuses (a standby refusing a read-write transaction, 25006) would never give its connection back,
  // while a refusal here rolls back and releases it (RAD-97, the auditor on #206).
  await tx.execute(!start.readOnly ? sql`set transaction isolation level read committed, read write`
    : start.isolation === 'repeatable read' ? sql`set transaction isolation level repeatable read, read only`
      : sql`set transaction isolation level read committed, read only`);
  const timeout = c.statementTimeoutMs === undefined ? null : String(c.statementTimeoutMs);
  await tx.execute(sql`select set_config('app.principal', ${c.principal}, true),
    set_config('app.request_id', ${c.requestId}, true),
    set_config('statement_timeout', coalesce(${timeout}::text, current_setting('statement_timeout')), true)`);
}
