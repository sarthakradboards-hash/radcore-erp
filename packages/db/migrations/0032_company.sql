CREATE TABLE "radcore"."company" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text NOT NULL,
	"state_code" text GENERATED ALWAYS AS (left(gstin, 2)) STORED NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"pincode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_company_legal_name" CHECK (char_length("radcore"."company"."legal_name") <= 200),
	CONSTRAINT "ck_company_address_line1" CHECK (char_length("radcore"."company"."address_line1") <= 200),
	CONSTRAINT "ck_company_address_line2" CHECK (char_length("radcore"."company"."address_line2") <= 200),
	CONSTRAINT "ck_company_city" CHECK (char_length("radcore"."company"."city") <= 100),
	CONSTRAINT "ck_company_one" CHECK ("radcore"."company"."id" = 1),
	CONSTRAINT "ck_company_gstin" CHECK ("radcore"."company"."gstin" ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "ck_company_pincode" CHECK ("radcore"."company"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c): who set the company's name, GSTIN or address, and when (RAD-88).
SELECT radcore.audit_attach('company', keep => array['legal_name', 'gstin', 'state_code', 'address_line1', 'address_line2', 'city', 'pincode']);
--> statement-breakpoint
-- The company profile's keys (RAD-88): admin holds every key; owner and accounts see the profile. Each joins the
-- role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES
  ('admin', 'company:read', 'all'), ('admin', 'company:write', 'all'),
  ('owner', 'company:read', 'all'), ('accounts', 'company:read', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES
  ('admin', 'company:read', 'all'), ('admin', 'company:write', 'all'),
  ('owner', 'company:read', 'all'), ('accounts', 'company:read', 'all')
ON CONFLICT DO NOTHING;
