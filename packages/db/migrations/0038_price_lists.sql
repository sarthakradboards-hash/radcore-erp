CREATE TABLE "radcore"."discount_limits" (
	"role" text PRIMARY KEY NOT NULL,
	"max_percent" numeric(9, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_discount_limits_max_percent" CHECK ("radcore"."discount_limits"."max_percent" between 0 and 100 and "radcore"."discount_limits"."max_percent" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."price_list_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_price_list_rates_rate" CHECK ("radcore"."price_list_rates"."rate" >= 0 and "radcore"."price_list_rates"."rate" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."price_list_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"tax_inclusive" boolean NOT NULL,
	"approved_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_price_list_versions_superseded" CHECK ("radcore"."price_list_versions"."superseded_at" is null or "radcore"."price_list_versions"."approved_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "radcore"."price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_price_lists_name" CHECK (char_length("radcore"."price_lists"."name") <= 80)
);
--> statement-breakpoint
ALTER TABLE "radcore"."discount_limits" ADD CONSTRAINT "discount_limits_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "radcore"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."price_list_rates" ADD CONSTRAINT "price_list_rates_version_id_price_list_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "radcore"."price_list_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."price_list_rates" ADD CONSTRAINT "price_list_rates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."price_list_versions" ADD CONSTRAINT "price_list_versions_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "radcore"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_price_list_rates_version_item" ON "radcore"."price_list_rates" USING btree ("version_id","item_id");--> statement-breakpoint
CREATE INDEX "ix_price_list_rates_item" ON "radcore"."price_list_rates" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_price_list_versions_list" ON "radcore"."price_list_versions" USING btree ("price_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_price_list_versions_draft" ON "radcore"."price_list_versions" USING btree ("price_list_id") WHERE "radcore"."price_list_versions"."approved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_price_list_versions_in_force" ON "radcore"."price_list_versions" USING btree ("price_list_id") WHERE ("radcore"."price_list_versions"."approved_at" is not null and "radcore"."price_list_versions"."superseded_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_price_lists_name_key" ON "radcore"."price_lists" USING btree ("name_key");--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c). A version's rates are its parts (ADR-001 §8b): their audit rows carry the
-- version's id, so maker-checker finds everyone who changed a draft since its last approval (RC-037).
SELECT radcore.audit_attach('price_lists', keep => array['name', 'name_key', 'active']);
--> statement-breakpoint
SELECT radcore.audit_attach('price_list_versions', keep => array['price_list_id', 'tax_inclusive', 'approved_at', 'superseded_at']);
--> statement-breakpoint
SELECT radcore.audit_attach('price_list_rates', keep => array['version_id', 'item_id', 'rate'],
  owner => 'version_id', owner_table => 'price_list_versions');
--> statement-breakpoint
SELECT radcore.audit_attach('discount_limits', keep => array['max_percent']);
--> statement-breakpoint
-- A list is switched off, never deleted, and a version, once made, stays as history. A draft's rate can be taken out
-- (lib-sales refuses it once the version is approved); a role's discount limit can be cleared, back to the default.
REVOKE DELETE, TRUNCATE ON radcore.price_lists, radcore.price_list_versions FROM radcore_app;
--> statement-breakpoint
-- The price keys (RAD-98), ordinary catalogue keys any role can be given (Sarthak: dynamic). The starting grants, in each
-- role's template too (RAD-83): the admin drafts price lists and the owner approves them (the plan's page 4); those
-- who quote or bill read them.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'prices:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter']) AS r
UNION ALL SELECT 'admin', 'prices:write', 'all'
UNION ALL SELECT r, 'prices:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'prices:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter']) AS r
UNION ALL SELECT 'admin', 'prices:write', 'all'
UNION ALL SELECT r, 'prices:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
