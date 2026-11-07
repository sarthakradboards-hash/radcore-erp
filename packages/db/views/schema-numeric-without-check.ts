// ADR-005 §1: every numeric column carries its CHECK, `ck_<table>_<column>`. Each row is a column without one, so a
// numeric column declared outside the helpers shows up here. Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { pgView, text } from 'drizzle-orm/pg-core';

export const vNumericWithoutCheck = pgView('v_schema_numeric_without_check', {
  schemaName: text(),
  tableName: text(),
  columnName: text(),
}).as(sql`select n.nspname::text as schema_name, c.relname::text as table_name, a.attname::text as column_name
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition and a.attnum > 0 and not a.attisdropped
    and a.atttypid = 'pg_catalog.numeric'::pg_catalog.regtype
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and not exists (select 1 from pg_catalog.pg_constraint k
      where k.conrelid = c.oid and k.contype = 'c' and k.conname = 'ck_' || c.relname || '_' || a.attname)`);
