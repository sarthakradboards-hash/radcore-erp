CREATE TABLE "radcore"."number_counters" (
	"series" text NOT NULL,
	"financial_year" text NOT NULL,
	"last" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_number_counters" PRIMARY KEY("series","financial_year")
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
        'change_reasons', 'user_sign_ins', 'number_counters'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- RAD-87 (ADR-006 §3, RC-206, RC-200): gap-free numbers. A series' first draw in a financial year inserts its row at 1;
-- every later draw updates it, and this trigger makes that exactly the last number plus one, whatever the app sent,
-- so no code can skip a number, reuse one, or move a counter to another series or year. The draw's row lock holds
-- until commit, so concurrent saves take turns, and a save that rolls back gives its number back.
CREATE FUNCTION radcore.number_counter_step() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last := 1;
  ELSIF NEW.series IS DISTINCT FROM OLD.series OR NEW.financial_year IS DISTINCT FROM OLD.financial_year THEN
    RAISE EXCEPTION 'a number counter keeps its series and year' USING ERRCODE = 'RA001';
  ELSE
    NEW.last := OLD.last + 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.number_counter_step() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER number_counter_step BEFORE INSERT OR UPDATE ON radcore.number_counters
  FOR EACH ROW EXECUTE FUNCTION radcore.number_counter_step();
--> statement-breakpoint
-- A counter is never deleted or emptied: that would hand its numbers out again.
CREATE TRIGGER refuse_delete BEFORE DELETE ON radcore.number_counters FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.number_counters FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
-- Machinery (ADR-005 §7c): stamped who-and-when, not row-audited. Each draw is its document's, and that is audited.
SELECT radcore.audit_attach('number_counters', capture => false);
