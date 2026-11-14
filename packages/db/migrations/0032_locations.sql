CREATE TABLE "radcore"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"code_key" text GENERATED ALWAYS AS (upper(btrim(code))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_locations_code" CHECK (char_length("radcore"."locations"."code") <= 20),
	CONSTRAINT "ck_locations_name" CHECK (char_length("radcore"."locations"."name") <= 120),
	CONSTRAINT "ck_locations_kind" CHECK ("radcore"."locations"."kind" in ('store', 'stores', 'service_bay', 'franchisee', 'rejected', 'demo', 'job_work', 'in_transit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_locations_code_key" ON "radcore"."locations" USING btree ("code_key");--> statement-breakpoint
CREATE INDEX "ix_locations_kind" ON "radcore"."locations" USING btree ("kind");--> statement-breakpoint
-- A master people make (ADR-005 §5, §7c): audited.
SELECT radcore.audit_attach('locations', keep => array['code', 'name', 'kind', 'active', 'code_key']);
--> statement-breakpoint
-- A master is switched off, never deleted (ADR-005 §3, D-12): the app's login can't delete one.
REVOKE DELETE, TRUNCATE ON radcore.locations FROM radcore_app;
--> statement-breakpoint
-- The stock module's first keys (the architect on RAD-92, from the plan's role table): everyone who touches stock
-- picks a location, so every role but HR and marketing reads them; admin keeps the masters. Admin holds every key, each
-- as its own row. The built-in templates are what shipped, so they get the same (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'locations:read', 'all' FROM unnest(array['owner', 'admin', 'counter', 'sales', 'stores', 'accounts', 'operations',
  'technician', 'service_head']) AS r
UNION ALL SELECT 'admin', 'locations:write', 'all';
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission IN ('locations:read', 'locations:write');
