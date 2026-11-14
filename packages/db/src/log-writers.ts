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

/** Appends the records an answer showed unmasked to access_log, one row per record, in one statement (RAD-40): in a
 * write's own transaction, or in a short write of its own after a read commits (ADR-005 §7c). The rows go as one JSON
 * parameter, since an array in a template would be spread into a list of parameters. */
export async function recordAccesses(handle: Tx, looks: readonly { table: string; id: string }[]): Promise<void> {
  const rows = JSON.stringify(looks.map((l) => ({ t: l.table, i: l.id })));
  await rawOf(handle).execute(sql`select radcore.record_access(l.t, l.i) from jsonb_to_recordset(${rows}::jsonb) as l(t text, i text)`);
}

/** Appends a record's opening to access_log, in a short write of its own after the read commits (ADR-005 §7c). */
export async function recordAccess(handle: Tx, recordTable: string, recordId: string): Promise<void> {
  await rawOf(handle).execute(sql`select radcore.record_access(${recordTable}, ${recordId})`);
}
