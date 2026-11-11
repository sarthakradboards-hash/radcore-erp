CREATE TABLE "radcore"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"delivery_id" text NOT NULL,
	"body_sha256" text NOT NULL,
	"payload" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_webhook_deliveries_body_sha256" CHECK ("radcore"."webhook_deliveries"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_webhook_deliveries_source_delivery_id" ON "radcore"."webhook_deliveries" USING btree ("source","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_webhook_deliveries_source_body_sha256" ON "radcore"."webhook_deliveries" USING btree ("source","body_sha256");--> statement-breakpoint
CREATE INDEX "ix_webhook_deliveries_unprocessed" ON "radcore"."webhook_deliveries" USING btree ("created_at") WHERE "radcore"."webhook_deliveries"."processed_at" is null;--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
--> statement-breakpoint
-- The view is recreated, so it takes the owner's default privileges again: read only for the app login, as 0012 made it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_schema_missing_triggers FROM radcore_app;
--> statement-breakpoint
-- RAD-45: payloads may be personal (an order's customer), so the read-only login never reads them.
REVOKE ALL ON radcore.webhook_deliveries FROM radcore_read;
--> statement-breakpoint
-- A machinery table (ADR-005 §7c): the who-and-when stamp only. Its rows are raw outside deliveries, not records
-- people change, so the audit log doesn't copy them.
SELECT radcore.audit_attach('webhook_deliveries', capture => false);
