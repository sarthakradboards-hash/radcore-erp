// ADR-005 §5: every table has created_at, created_by, updated_at and updated_by. Each row is a table missing one.
// Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { pgView, text } from 'drizzle-orm/pg-core';

export const vMissingAudit = pgView('v_schema_missing_audit', {
  schemaName: text(),
  tableName: text(),
}).as(sql`select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and not a.attisdropped
        and a.attname in ('created_at', 'created_by', 'updated_at', 'updated_by')) < 4`);
