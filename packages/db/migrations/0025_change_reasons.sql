CREATE TABLE "radcore"."change_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_change_reasons_reason" CHECK (char_length("radcore"."change_reasons"."reason") <= 500)
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions',
        'change_reasons'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- RAD-36 (the architect on RAD-36, ADR-005 §7c): why a change was made. The reason is kept here once, and each audit
-- row of the change carries its id, never its text: free text can hold personal data, and the audit log is append-only
-- (M6-16, references not copies), so the text can be corrected or erased later (D-09) without touching an audit row.
-- Stamped who-and-when, but not copied into the audit log.
SELECT radcore.audit_attach('change_reasons', capture => false);
--> statement-breakpoint
-- Written only through record_change_reason, like event_log through record_event; the read-only login sees none of it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.change_reasons FROM radcore_app;
--> statement-breakpoint
REVOKE ALL ON radcore.change_reasons FROM radcore_read;
--> statement-breakpoint
-- Each audit row takes the change's reason from the request context, as it takes its principal (expand only: nullable).
ALTER TABLE radcore.audit_log ADD COLUMN reason_id uuid DEFAULT nullif(current_setting('app.reason_id', true), '')::uuid;
--> statement-breakpoint
-- Keeps the reason and sets app.reason_id for this transaction, so every audit row the change writes points at it.
CREATE FUNCTION radcore.record_change_reason(reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  kept uuid;
BEGIN
  INSERT INTO radcore.change_reasons (reason) VALUES (reason) RETURNING id INTO kept;
  PERFORM set_config('app.reason_id', kept::text, true);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.record_change_reason(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION radcore.record_change_reason(text) TO radcore_app;
