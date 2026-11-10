CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_unredacted_secrets" AS (select c.relname::text as table_name, a.attname::text as column_name
  from pg_catalog.pg_trigger g
  join pg_catalog.pg_class c on c.oid = g.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore'
    and a.attname ~ '(hash|secret|token|ciphertext|password)'
    and not (a.attname = any (string_to_array(split_part(encode(g.tgargs, 'escape'), '\000', 2), ','))));--> statement-breakpoint
-- ADR-005 §7c: these views are read-only for the app login (the owner's default privileges would give it writes).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_schema_missing_triggers, radcore.v_schema_unredacted_secrets FROM radcore_app;
