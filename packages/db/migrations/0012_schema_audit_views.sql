CREATE VIEW "radcore"."v_schema_audit_columns" AS (with audited as (
    select c.oid, c.relname,
      string_to_array(split_part(encode(g.tgargs, 'escape'), '\000',1), ',') as keys,
      string_to_array(nullif(split_part(encode(g.tgargs, 'escape'), '\000',2), ''), ',') as keep,
      string_to_array(nullif(split_part(encode(g.tgargs, 'escape'), '\000',3), ''), ',') as redact
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore'
  ), columns as (
    select t.relname, a.attname,
      a.attname = any (coalesce(t.keep, '{}')) as kept, a.attname = any (coalesce(t.redact, '{}')) as redacted,
      a.attname = any (t.keys || array['created_at', 'created_by', 'updated_at', 'updated_by']) as exempt
    from audited t
    join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  )
  select relname::text as table_name, attname::text as column_name, 'unlisted' as problem from columns
    where not exempt and not kept and not redacted
  union all
  select relname::text, attname::text, 'kept and redacted' from columns where kept and redacted
  union all
  select relname::text, attname::text, 'a secret not redacted' from columns
    where attname ~ '(hash|secret|token|ciphertext|password)' and not redacted);--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));--> statement-breakpoint
-- ADR-005 §7c: these views are read-only for the app login (the owner's default privileges would give it writes).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_schema_missing_triggers, radcore.v_schema_audit_columns FROM radcore_app;
