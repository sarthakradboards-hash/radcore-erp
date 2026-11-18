CREATE TABLE "radcore"."parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"customer" boolean DEFAULT false NOT NULL,
	"dealer" boolean DEFAULT false NOT NULL,
	"franchisee" boolean DEFAULT false NOT NULL,
	"supplier" boolean DEFAULT false NOT NULL,
	"gstin" text,
	"pan" text,
	"composition" boolean DEFAULT false NOT NULL,
	"state_code" text NOT NULL,
	"phone" text,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"pincode" text,
	"credit_days" smallint,
	"credit_limit" numeric(18, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_parties_name" CHECK (char_length("radcore"."parties"."name") <= 200),
	CONSTRAINT "ck_parties_email" CHECK (char_length("radcore"."parties"."email") <= 254),
	CONSTRAINT "ck_parties_address_line1" CHECK (char_length("radcore"."parties"."address_line1") <= 200),
	CONSTRAINT "ck_parties_address_line2" CHECK (char_length("radcore"."parties"."address_line2") <= 200),
	CONSTRAINT "ck_parties_city" CHECK (char_length("radcore"."parties"."city") <= 100),
	CONSTRAINT "ck_parties_credit_limit" CHECK ("radcore"."parties"."credit_limit" >= 0 and "radcore"."parties"."credit_limit" <> 'NaN'),
	CONSTRAINT "ck_parties_kinds" CHECK ("radcore"."parties"."customer" or "radcore"."parties"."dealer" or "radcore"."parties"."franchisee" or "radcore"."parties"."supplier"),
	CONSTRAINT "ck_parties_gstin" CHECK ("radcore"."parties"."gstin" ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "ck_parties_pan" CHECK ("radcore"."parties"."pan" ~ '^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$'),
	CONSTRAINT "ck_parties_pan_in_gstin" CHECK ("radcore"."parties"."gstin" is null or "radcore"."parties"."pan" is null or substr("radcore"."parties"."gstin", 3, 10) = "radcore"."parties"."pan"),
	CONSTRAINT "ck_parties_state" CHECK ("radcore"."parties"."state_code" ~ '^[0-9]{2}$' and ("radcore"."parties"."gstin" is null or left("radcore"."parties"."gstin", 2) = "radcore"."parties"."state_code")),
	CONSTRAINT "ck_parties_composition" CHECK (not "radcore"."parties"."composition" or "radcore"."parties"."gstin" is not null),
	CONSTRAINT "ck_parties_phone" CHECK ("radcore"."parties"."phone" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "ck_parties_pincode" CHECK ("radcore"."parties"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "ck_parties_credit_days" CHECK ("radcore"."parties"."credit_days" between 0 and 365)
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_parties_gstin" ON "radcore"."parties" USING btree ("gstin");--> statement-breakpoint
CREATE INDEX "ix_parties_name_trgm" ON "radcore"."parties" USING gin ("name" radcore_ext.gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" <> 'parties:contact' or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" <> 'parties:contact' or "radcore"."role_templates"."scope" = 'all'));
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c), with the personal columns written as [redacted] (RAD-40, M6-16): the
-- trail says a phone or an address changed, never what it was.
SELECT radcore.audit_attach('parties',
  keep => array['name', 'customer', 'dealer', 'franchisee', 'supplier', 'gstin', 'pan', 'composition', 'state_code', 'credit_days', 'credit_limit', 'active'],
  redact => array['phone', 'email', 'address_line1', 'address_line2', 'city', 'pincode']);
--> statement-breakpoint
-- Masters are switched off, never deleted (ADR-005 §3).
REVOKE DELETE, TRUNCATE ON radcore.parties FROM radcore_app;
--> statement-breakpoint
-- The parties keys (RAD-90), ordinary catalogue keys any role can be given (Sarthak: dynamic). The plan's starting
-- grants, in each role's template too, so a reset keeps them (RAD-83). Credit terms are parties:manage only, with the
-- second factor (D-19, Sarthak). parties:contact shows a party's contact details on screens (Sarthak: "via own
-- permission"): sales and the store counter, plus admin, and owner so it can grant it on; technician isn't given it.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'parties:read', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter', 'accounts', 'stores', 'service_head']) AS r
UNION ALL SELECT r, 'parties:write', 'all' FROM unnest(array['admin', 'sales', 'counter', 'accounts', 'stores']) AS r
UNION ALL SELECT r, 'parties:manage', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'parties:contact', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'parties:read', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter', 'accounts', 'stores', 'service_head']) AS r
UNION ALL SELECT r, 'parties:write', 'all' FROM unnest(array['admin', 'sales', 'counter', 'accounts', 'stores']) AS r
UNION ALL SELECT r, 'parties:manage', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'parties:contact', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter']) AS r
ON CONFLICT DO NOTHING;
