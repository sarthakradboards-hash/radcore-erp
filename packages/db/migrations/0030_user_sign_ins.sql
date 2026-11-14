CREATE TABLE "radcore"."user_sign_ins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"sort_key" timestamp with time zone GENERATED ALWAYS AS (coalesce(last_sign_in_at, timestamptz 'epoch')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
ALTER TABLE "radcore"."user_sign_ins" ADD CONSTRAINT "user_sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_user_sign_ins_sort_key" ON "radcore"."user_sign_ins" USING btree ("sort_key","user_id");--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions',
        'change_reasons', 'user_sign_ins'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- RAD-36 (the architect on RAD-36, ADR-005 §7c): when each person last signed in, off the audited users table, since a
-- sign-in is already a sign_in event. Machinery: stamped who-and-when, not row-audited.
SELECT radcore.audit_attach('user_sign_ins', capture => false);
--> statement-breakpoint
-- Every person has the row, so the people list joins it inner. Those already here get theirs, with the start of their
-- latest session as their last sign-in, stamped by the runner as system:migrate.
INSERT INTO "radcore"."user_sign_ins" ("user_id", "last_sign_in_at")
  SELECT u.id, (SELECT max(s.created_at) FROM "radcore"."sessions" s WHERE s.user_id = u.id) FROM "radcore"."users" u;
