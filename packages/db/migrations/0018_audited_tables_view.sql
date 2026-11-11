CREATE VIEW "radcore"."v_audited_tables" AS (select c.relname::text as table_name
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore');--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_audited_tables FROM radcore_app;