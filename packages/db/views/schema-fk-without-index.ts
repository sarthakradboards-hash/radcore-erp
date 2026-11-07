// ADR-005 §3: each foreign key's columns lead an index, or the primary key (RC-029). Each row is a foreign key without
// one. Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { pgView, text } from 'drizzle-orm/pg-core';

export const vFkWithoutIndex = pgView('v_schema_fk_without_index', {
  schemaName: text(),
  tableName: text(),
  constraintName: text(),
}).as(sql`select n.nspname::text as schema_name, c.relname::text as table_name, k.conname::text as constraint_name
  from pg_catalog.pg_constraint k
  join pg_catalog.pg_class c on c.oid = k.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and not exists (select 1 from pg_catalog.pg_index i
      where i.indrelid = k.conrelid
        and array_to_string((i.indkey::int2[])[0:cardinality(k.conkey) - 1], ',') = array_to_string(k.conkey, ','))`);
