CREATE TABLE "radcore"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"designation" text,
	"joined_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"code_key" text GENERATED ALWAYS AS (upper(btrim(code))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_employees_code" CHECK (char_length("radcore"."employees"."code") <= 20),
	CONSTRAINT "ck_employees_name" CHECK (char_length("radcore"."employees"."name") <= 120),
	CONSTRAINT "ck_employees_phone" CHECK (char_length("radcore"."employees"."phone") <= 16),
	CONSTRAINT "ck_employees_email" CHECK (char_length("radcore"."employees"."email") <= 254),
	CONSTRAINT "ck_employees_designation" CHECK (char_length("radcore"."employees"."designation") <= 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_employees_code_key" ON "radcore"."employees" USING btree ("code_key");--> statement-breakpoint
-- A master people make (ADR-005 §5, §7c): audited, with the phone and email redacted, so the log says only that they
-- changed (personal data, RAD-40). Switched off, never deleted (D-12): the app's login can't delete one.
SELECT radcore.audit_attach('employees', keep => array['code', 'name', 'designation', 'joined_on', 'active', 'code_key'],
  redact => array['phone', 'email']);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.employees FROM radcore_app;
--> statement-breakpoint
-- RAD-92's keys, as ordinary catalogue keys any role may be granted on the role screens (Sarthak, 15 Nov). These are
-- the built-in roles' starting grants, from the plan's role table (the architect on RAD-92): employees:read for the
-- people who allocate or pay people, employees:write for admin and HR, cost:read for admin, owner, accounts and stores.
-- The service manager starts without cost:read. Admin holds every key, each as its own row. The built-in templates are
-- what shipped, so they get the same (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'employees:read', 'all' FROM unnest(array['admin', 'owner', 'hr', 'accounts', 'operations', 'service_head']) AS r
UNION ALL SELECT r, 'employees:write', 'all' FROM unnest(array['admin', 'hr']) AS r
UNION ALL SELECT r, 'cost:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'stores']) AS r;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission IN ('employees:read', 'employees:write', 'cost:read');
