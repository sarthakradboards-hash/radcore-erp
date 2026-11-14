// The calls to the database's log functions (ADR-002 §3, RAD-31): the app has no INSERT on event_log or access_log, so
// a SECURITY DEFINER function is the only way in (ADR-005 §7c). Each is one bound-parameter `select` of one such
// function, and nothing else; tools/log-writers.test.ts pins them. The principal and the time are the database's own:
// the functions read them from the request context and now(). Only lib-platform imports this file (D7).
import { sql } from 'drizzle-orm';
import { rawOf, type Tx } from './tx.ts';

/** One security event; lib-platform's securityEvent schema has checked `kind` and `detail` first. */
export type EventRow = { kind: string; userId: string | null; device: string | null; detail: Record<string, unknown> };

/** Keeps a change's reason in the request's transaction, and sets app.reason_id, so each audit row of the change
 * carries it (RAD-36). */
export async function recordReason(handle: Tx, reason: string): Promise<void> {
  await rawOf(handle).execute(sql`select radcore.record_change_reason(${reason})`);
}

/** Appends a security event in the request's transaction, kept only if it commits (RAD-31). */
export async function recordEvent(handle: Tx, e: EventRow): Promise<void> {
  await rawOf(handle).execute(
    sql`select radcore.record_event(${e.kind}, ${e.userId}::uuid, ${e.device}, ${JSON.stringify(e.detail)}::jsonb)`);
}
