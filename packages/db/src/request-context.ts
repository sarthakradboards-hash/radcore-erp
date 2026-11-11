// The one helper run at the start of each transaction (ADR-002 §3, §4): who the work is for and which request it
// belongs to, for the audit triggers (ADR-005 §5), and the contract's statement timeout. Everything is set with
// set_config(..., true), so it lasts for this transaction only, and every value is a bound parameter.
import { sql } from 'drizzle-orm';
import type { RawTx } from './tx.ts';

export type RequestContext = {
  /** `user:<id>`, `system:<name>` or `link:<id>` (ADR-001 §6a). */
  principal: string;
  requestId: string;
  /** This transaction's statement timeout; without one, the connection's own stays. */
  statementTimeoutMs?: number | undefined;
};

export async function applyRequestContext(tx: RawTx, c: RequestContext): Promise<void> {
  const timeout = c.statementTimeoutMs === undefined ? null : String(c.statementTimeoutMs);
  await tx.execute(sql`select set_config('app.principal', ${c.principal}, true),
    set_config('app.request_id', ${c.requestId}, true),
    set_config('statement_timeout', coalesce(${timeout}::text, current_setting('statement_timeout')), true)`);
}
