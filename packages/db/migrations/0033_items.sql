CREATE TABLE "radcore"."item_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_item_categories_name" CHECK (char_length("radcore"."item_categories"."name") <= 80)
);
--> statement-breakpoint
CREATE TABLE "radcore"."items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"sku_key" text GENERATED ALWAYS AS (upper(sku)) STORED NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"hsn" text NOT NULL,
	"unit" text NOT NULL,
	"barcode" text,
	"serialised" boolean DEFAULT false NOT NULL,
	"has_chassis" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_items_name" CHECK (char_length("radcore"."items"."name") <= 200),
	CONSTRAINT "ck_items_sku" CHECK ("radcore"."items"."sku" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
	CONSTRAINT "ck_items_hsn" CHECK ("radcore"."items"."hsn" ~ '^[0-9]{4}([0-9]{2}){0,2}$'),
	CONSTRAINT "ck_items_barcode" CHECK ("radcore"."items"."barcode" ~ '^[!-~]{1,48}$'),
	CONSTRAINT "ck_items_chassis" CHECK (not "radcore"."items"."has_chassis" or "radcore"."items"."serialised")
);
--> statement-breakpoint
CREATE TABLE "radcore"."units_of_measure" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"decimals" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_units_of_measure_name" CHECK (char_length("radcore"."units_of_measure"."name") <= 60),
	CONSTRAINT "ck_units_of_measure_code" CHECK ("radcore"."units_of_measure"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ck_units_of_measure_decimals" CHECK ("radcore"."units_of_measure"."decimals" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "radcore"."items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "radcore"."item_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."items" ADD CONSTRAINT "items_unit_units_of_measure_code_fk" FOREIGN KEY ("unit") REFERENCES "radcore"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_item_categories_name_key" ON "radcore"."item_categories" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_items_sku_key" ON "radcore"."items" USING btree ("sku_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_items_barcode" ON "radcore"."items" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "ix_items_category_id" ON "radcore"."items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ix_items_unit" ON "radcore"."items" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "ix_items_name_trgm" ON "radcore"."items" USING gin ("name" radcore_ext.gin_trgm_ops);
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c): who added or changed an item, a category or a unit, and when (RAD-89).
SELECT radcore.audit_attach('units_of_measure', keep => array['name', 'decimals']);
--> statement-breakpoint
SELECT radcore.audit_attach('item_categories', keep => array['name', 'name_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('items', keep => array['sku', 'sku_key', 'name', 'category_id', 'hsn', 'unit', 'barcode', 'serialised', 'has_chassis']);
--> statement-breakpoint
-- GST's unit quantity codes the business uses, each with the decimals its quantities may have (RC-162): a count has
-- none, so 1.5 Nos can't be entered.
INSERT INTO radcore.units_of_measure (code, name, decimals) VALUES
  ('NOS', 'Numbers', 0), ('PCS', 'Pieces', 0), ('SET', 'Sets', 0), ('PRS', 'Pairs', 0), ('BOX', 'Boxes', 0),
  ('ROL', 'Rolls', 0), ('KGS', 'Kilograms', 3), ('MTR', 'Metres', 2), ('SQM', 'Square metres', 2), ('LTR', 'Litres', 3);
--> statement-breakpoint
-- The items keys (RAD-89), ordinary catalogue keys any role can be given (Sarthak: dynamic). These are the plan's
-- starting grants, in each role's template too, so a reset keeps them (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'stores']) AS r, unnest(array['items:read', 'items:write']) AS k
UNION ALL
SELECT r, 'items:read', 'all' FROM unnest(array['owner', 'sales', 'counter', 'accounts', 'service_head', 'technician']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'stores']) AS r, unnest(array['items:read', 'items:write']) AS k
UNION ALL
SELECT r, 'items:read', 'all' FROM unnest(array['owner', 'sales', 'counter', 'accounts', 'service_head', 'technician']) AS r
ON CONFLICT DO NOTHING;
