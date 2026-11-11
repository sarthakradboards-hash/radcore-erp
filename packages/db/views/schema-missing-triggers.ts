// ADR-005 §5, §7c (RAD-30): every table has the who-and-when trigger, and every table the audit trigger but the three
// logs (not audited, so audit rows aren't audited in turn) and the machinery ADR-005 §7c names (saved_once, jobs_outbox, webhook_deliveries),
// both attached by radcore.audit_attach in its migration. Each row is a table missing one, named.
// Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vMissingTriggers = radcore.view('v_schema_missing_triggers', {
  schemaName: text(),
  tableName: text(),
  missing: text(),
}).as(sql`select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal)`);
