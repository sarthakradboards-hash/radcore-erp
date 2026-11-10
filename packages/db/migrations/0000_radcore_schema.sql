CREATE SCHEMA "radcore";
--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_enums" AS (select n.nspname::text as schema_name, t.typname::text as type_name
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_');--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_fk_without_index" AS (select n.nspname::text as schema_name, c.relname::text as table_name, k.conname::text as constraint_name
  from pg_catalog.pg_constraint k
  join pg_catalog.pg_class c on c.oid = k.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and not exists (select 1 from pg_catalog.pg_index i
      where i.indrelid = k.conrelid
        and array_to_string((i.indkey::int2[])[0:cardinality(k.conkey) - 1], ',') = array_to_string(k.conkey, ',')));--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_audit" AS (select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and not a.attisdropped
        and a.attname in ('created_at', 'created_by', 'updated_at', 'updated_by')) < 4);--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_numeric_without_check" AS (select n.nspname::text as schema_name, c.relname::text as table_name, a.attname::text as column_name
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition and a.attnum > 0 and not a.attisdropped
    and a.atttypid = 'pg_catalog.numeric'::pg_catalog.regtype
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle') and left(n.nspname, 3) <> 'pg_'
    and not exists (select 1 from pg_catalog.pg_constraint k
      where k.conrelid = c.oid and k.contype = 'c' and k.conname = 'ck_' || c.relname || '_' || a.attname));--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_public_relations" AS (select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname = 'public');