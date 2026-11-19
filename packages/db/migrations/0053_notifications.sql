CREATE TABLE "radcore"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"record_table" text NOT NULL,
	"record_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_notifications_kind" CHECK ("radcore"."notifications"."kind" ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service).[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_notifications_record_table" CHECK ("radcore"."notifications"."record_table" ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || "radcore"."notifications"."record_table") is not null)
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
ALTER TABLE "radcore"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_notifications_user_at" ON "radcore"."notifications" USING btree ("user_id","at","id");--> statement-breakpoint
CREATE INDEX "ix_notifications_unread" ON "radcore"."notifications" USING btree ("user_id") WHERE "radcore"."notifications"."read_at" is null;--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions',
        'change_reasons', 'user_sign_ins', 'number_counters', 'pending_document_checks', 'stock_positions', 'notifications'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- Notifications are machinery (ADR-005 §7c, RAD-121): the who-and-when trigger, no audit rows. A notification holds
-- only references, and its being read is the person's own working state.
SELECT radcore.audit_attach('notifications', capture => false);
--> statement-breakpoint
-- The app adds one and marks it read; it never retargets, rewrites or removes one.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.notifications FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (read_at) ON radcore.notifications TO radcore_app;
