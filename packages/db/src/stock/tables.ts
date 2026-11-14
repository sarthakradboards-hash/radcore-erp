// The stock module's tables (ADR-005, ADR-006 §4, M2-14 / RAD-92): the places stock can be. SQL zone (ADR-002 §3):
// `sql` only in a CHECK and a generated column. The stock ledger (M2-05) joins them here.
import { sql } from 'drizzle-orm';
import { boolean, check, index, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';

/**
 * A place stock can be: the sales floor, the stock room, a service bay, a franchisee, a job worker. Its kind is one
 * of lib-common's fixed LOCATION_KINDS (ADR-005 §4). Its code is unique whatever its case or spacing (`code_key`).
 * Switched off, never deleted (ADR-005 §3, D-12). A franchisee's or job worker's party comes later, expand-only.
 */
export const locations = radcoreTable('locations', {
  id: id(),
  code: boundedText({ max: 20 }).notNull(),
  name: boundedText({ max: 120 }).notNull(),
  kind: text().notNull(),
  active: boolean().notNull().default(true),
  codeKey: text().notNull().generatedAlwaysAs(sql`upper(btrim(code))`),
}, (t) => [
  // LOCATION_KINDS' codes, written out because L1 allows only a plain `sql` here; tables.test.ts holds the two equal.
  check('ck_locations_kind',
    sql`${t.kind} in ('store', 'stores', 'service_bay', 'franchisee', 'rejected', 'demo', 'job_work', 'in_transit')`),
  uniqueIndex('ux_locations_code_key').on(t.codeKey),
  index('ix_locations_kind').on(t.kind),
]);
