// The one helper run at the start of each transaction (ADR-002 §3, §4): who the work is for and which request it
// belongs to, for the audit triggers (ADR-005 §5), and the contract's statement timeout. Everything is set with
// set_config(..., true), so it lasts for this transaction only, and every value is a bound parameter.
import { sql } from 'drizzle-orm';
import { rawOf, type RawTx, type Tx } from './tx.ts';

export type RequestContext = {
  /** `user:<id>`, `system:<name>` or `link:<id>` (ADR-001 §6a). */
  principal: string;
  requestId: string;
  /** This transaction's statement timeout; without one, the connection's own stays. */
  statementTimeoutMs?: number | undefined;
};

/** One security event, appended through record_event (RAD-31, ADR-005 §7c); lib-platform checks `detail` first. */
export type EventRow = { kind: string; userId: string | null; device: string | null; detail: Record<string, unknown> };

/**
 * Appends a security event in the request's transaction. The app has no INSERT on event_log, so this one call is the
 * way in; the principal and the time come from the request context and now(), never from here.
 */
export async function recordEvent(handle: Tx, e: EventRow): Promise<void> {
  await rawOf(handle).execute(sql`select radcore.record_event(${e.kind}, ${e.userId}::uuid, ${e.device},
    ${JSON.stringify(e.detail)}::jsonb)`);
}

export async function applyRequestContext(tx: RawTx, c: RequestContext): Promise<void> {
  const timeout = c.statementTimeoutMs === undefined ? null : String(c.statementTimeoutMs);
  await tx.execute(sql`select set_config('app.principal', ${c.principal}, true),
    set_config('app.request_id', ${c.requestId}, true),
    set_config('statement_timeout', coalesce(${timeout}::text, current_setting('statement_timeout')), true)`);
}
