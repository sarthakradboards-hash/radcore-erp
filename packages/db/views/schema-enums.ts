// ADR-005 §4: no PostgreSQL enum type; a growing list is a lookup table, a state machine a CHECK (RC-044). Each row is
// an enum. Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vEnums = radcore.view('v_schema_enums', {
  schemaName: text(),
  typeName: text(),
}).as(sql`select n.nspname::text as schema_name, t.typname::text as type_name
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'`);
