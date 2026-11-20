CREATE TABLE "radcore"."series_prefixes" (
	"series" text NOT NULL,
	"from_year" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_series_prefixes" PRIMARY KEY("series","from_year"),
	CONSTRAINT "ck_series_prefixes_from_year" CHECK ("radcore"."series_prefixes"."from_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "ck_series_prefixes_prefix" CHECK ("radcore"."series_prefixes"."prefix" ~ '^[A-Z0-9]{1,4}$')
);
--> statement-breakpoint
-- RAD-132 (ADR-001 §8c, ADR-006 §3): a series' prefix history, audited with the reason its change carries. A row is
-- replaced by a second change for the same year, never deleted.
SELECT radcore.audit_attach('series_prefixes', keep => array['series', 'from_year', 'prefix']);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.series_prefixes FROM radcore_app;
--> statement-breakpoint
-- A prefix that was a setting (`<series>_prefix`) moves into the history from the earliest year, so every year still
-- to draw its first number takes it, as it would have; a year already drawn keeps its counter's prefix.
INSERT INTO radcore.series_prefixes (series, from_year, prefix)
  SELECT left(key, -length('_prefix')), '1900-01', value #>> '{}'
  FROM radcore.settings WHERE key ~ '_prefix$' AND jsonb_typeof(value) = 'string' AND value #>> '{}' ~ '^[A-Z0-9]{1,4}$';
--> statement-breakpoint
DELETE FROM radcore.settings WHERE key ~ '_prefix$';
--> statement-breakpoint
-- The counter's trigger (migration 0038), now also:
-- - a year's first number takes the latest prefix in series_prefixes on or before the year, else the one the app sent
--   (the series' declared prefix), in the same upsert;
-- - a year's row can be made ahead of its first number, with `last` 0, and its prefix changed only while it's still 0,
--   so a change for this year and the year's first number take turns on the row's lock (RAD-132). Once a number is
--   drawn, a prefix change is refused.
CREATE OR REPLACE FUNCTION radcore.number_counter_step() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last := CASE WHEN NEW.last = 0 THEN 0 ELSE 1 END;
    NEW.prefix := coalesce((SELECT p.prefix FROM radcore.series_prefixes p WHERE p.series = NEW.series
      AND p.from_year <= NEW.financial_year ORDER BY p.from_year DESC LIMIT 1), NEW.prefix);
  ELSIF NEW.series IS DISTINCT FROM OLD.series OR NEW.financial_year IS DISTINCT FROM OLD.financial_year THEN
    RAISE EXCEPTION 'a number counter keeps its series and year' USING ERRCODE = 'RA001';
  ELSIF NEW.prefix IS DISTINCT FROM OLD.prefix THEN
    -- A prefix change, only before the year's first number (series_in_use, said first by the service).
    IF OLD.last <> 0 THEN
      RAISE EXCEPTION 'a year''s prefix is the one its first number took' USING ERRCODE = 'RA001';
    END IF;
    NEW.last := 0;
  ELSE
    NEW.last := OLD.last + 1;
    NEW.prefix := OLD.prefix;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- RAD-132's keys: settings:read for admin, owner and accounts; settings:write for admin and owner. Each joins the role's
-- template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES
  ('admin', 'settings:read', 'all'), ('admin', 'settings:write', 'all'),
  ('owner', 'settings:read', 'all'), ('owner', 'settings:write', 'all'), ('accounts', 'settings:read', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES
  ('admin', 'settings:read', 'all'), ('admin', 'settings:write', 'all'),
  ('owner', 'settings:read', 'all'), ('owner', 'settings:write', 'all'), ('accounts', 'settings:read', 'all')
ON CONFLICT DO NOTHING;
