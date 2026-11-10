// ADR-005 §7c: every table and view lives in the `radcore` schema, which the trigger functions' search_path names;
// nothing lands in `public`. Each row is a table or view in `public`. Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vPublicRelations = radcore.view('v_schema_public_relations', {
  schemaName: text(),
  tableName: text(),
}).as(sql`select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname = 'public'`);
