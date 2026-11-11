CREATE TABLE "radcore"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_sessions_device" CHECK (char_length("radcore"."sessions"."device") <= 80),
	CONSTRAINT "ck_sessions_token_hash" CHECK ("radcore"."sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_sessions_ended_reason" CHECK ("radcore"."sessions"."ended_reason" in ('sign_out', 'admin', 'password_changed', 'password_reset', 'role_changed', 'deactivated')),
	CONSTRAINT "ck_sessions_ended" CHECK (("radcore"."sessions"."ended_at" is null) = ("radcore"."sessions"."ended_reason" is null))
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
ALTER TABLE "radcore"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sessions_token_hash" ON "radcore"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_sessions_user_id" ON "radcore"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
--> statement-breakpoint
-- RAD-34: stamped who-and-when, not row-audited, like saved_once and jobs_outbox (ADR-005 §7c): last_seen_at moves on
-- every request, and a session's start and end are security events. The read-only login never sees a token's hash.
SELECT radcore.audit_attach('sessions', capture => false);
--> statement-breakpoint
REVOKE SELECT ON "radcore"."sessions" FROM radcore_read;
--> statement-breakpoint
GRANT SELECT ("id", "user_id", "device", "last_seen_at", "idle_expires_at", "absolute_expires_at", "ended_at", "ended_reason", "created_at", "created_by", "updated_at", "updated_by") ON "radcore"."sessions" TO radcore_read;
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
