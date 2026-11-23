CREATE TABLE "radcore"."purchase_order_limits" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"role" text PRIMARY KEY NOT NULL,
	"max_total" numeric(18, 2) NOT NULL,
	CONSTRAINT "ck_purchase_order_limits_max_total" CHECK ("radcore"."purchase_order_limits"."max_total" >= 0 and "radcore"."purchase_order_limits"."max_total" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."purchase_order_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"gst_rate" numeric(9, 6),
	"gst_rate_source" text,
	"taxable" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"line_total" numeric(18, 2),
	CONSTRAINT "ck_purchase_order_lines_qty" CHECK ("radcore"."purchase_order_lines"."qty" > 0 and "radcore"."purchase_order_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_rate" CHECK ("radcore"."purchase_order_lines"."rate" >= 0 and "radcore"."purchase_order_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_gst_rate" CHECK ("radcore"."purchase_order_lines"."gst_rate" between 0 and 100 and "radcore"."purchase_order_lines"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_gst_rate_source" CHECK (char_length("radcore"."purchase_order_lines"."gst_rate_source") <= 200),
	CONSTRAINT "ck_purchase_order_lines_taxable" CHECK ("radcore"."purchase_order_lines"."taxable" >= 0 and "radcore"."purchase_order_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_cgst" CHECK ("radcore"."purchase_order_lines"."cgst" >= 0 and "radcore"."purchase_order_lines"."cgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_sgst" CHECK ("radcore"."purchase_order_lines"."sgst" >= 0 and "radcore"."purchase_order_lines"."sgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_igst" CHECK ("radcore"."purchase_order_lines"."igst" >= 0 and "radcore"."purchase_order_lines"."igst" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_line_total" CHECK ("radcore"."purchase_order_lines"."line_total" >= 0 and "radcore"."purchase_order_lines"."line_total" <> 'NaN'),
	CONSTRAINT "ck_purchase_order_lines_frozen" CHECK (num_nulls("radcore"."purchase_order_lines"."gst_rate", "radcore"."purchase_order_lines"."gst_rate_source", "radcore"."purchase_order_lines"."taxable", "radcore"."purchase_order_lines"."cgst", "radcore"."purchase_order_lines"."sgst", "radcore"."purchase_order_lines"."igst",
    "radcore"."purchase_order_lines"."line_total") in (0, 7)),
	CONSTRAINT "ck_purchase_order_lines_identity" CHECK ("radcore"."purchase_order_lines"."line_total" = "radcore"."purchase_order_lines"."taxable" + "radcore"."purchase_order_lines"."cgst" + "radcore"."purchase_order_lines"."sgst" + "radcore"."purchase_order_lines"."igst"
    and "radcore"."purchase_order_lines"."cgst" = "radcore"."purchase_order_lines"."sgst" and ("radcore"."purchase_order_lines"."igst" = 0 or "radcore"."purchase_order_lines"."cgst" = 0))
);
--> statement-breakpoint
CREATE TABLE "radcore"."purchase_orders" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"expected_by" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"close_reason" text,
	"approved_total" numeric(18, 2),
	"place_of_supply" text,
	"taxable" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"round_off" numeric(18, 2),
	"total" numeric(18, 2),
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_purchase_orders_notes" CHECK (char_length("radcore"."purchase_orders"."notes") <= 500),
	CONSTRAINT "ck_purchase_orders_close_reason" CHECK (char_length("radcore"."purchase_orders"."close_reason") <= 500),
	CONSTRAINT "ck_purchase_orders_approved_total" CHECK ("radcore"."purchase_orders"."approved_total" >= 0 and "radcore"."purchase_orders"."approved_total" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_taxable" CHECK ("radcore"."purchase_orders"."taxable" >= 0 and "radcore"."purchase_orders"."taxable" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_cgst" CHECK ("radcore"."purchase_orders"."cgst" >= 0 and "radcore"."purchase_orders"."cgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_sgst" CHECK ("radcore"."purchase_orders"."sgst" >= 0 and "radcore"."purchase_orders"."sgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_igst" CHECK ("radcore"."purchase_orders"."igst" >= 0 and "radcore"."purchase_orders"."igst" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_round_off" CHECK ("radcore"."purchase_orders"."round_off" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_total" CHECK ("radcore"."purchase_orders"."total" >= 0 and "radcore"."purchase_orders"."total" <> 'NaN'),
	CONSTRAINT "ck_purchase_orders_frozen" CHECK (num_nulls("radcore"."purchase_orders"."place_of_supply", "radcore"."purchase_orders"."taxable", "radcore"."purchase_orders"."cgst", "radcore"."purchase_orders"."sgst", "radcore"."purchase_orders"."igst", "radcore"."purchase_orders"."round_off", "radcore"."purchase_orders"."total") in (0, 7)
    and case "radcore"."purchase_orders"."status" when 'draft' then "radcore"."purchase_orders"."total" is null when 'cancelled' then true else "radcore"."purchase_orders"."total" is not null end and coalesce("radcore"."purchase_orders"."place_of_supply", '00') ~ '^[0-9]{2}$'),
	CONSTRAINT "ck_purchase_orders_identity" CHECK ("radcore"."purchase_orders"."total" = "radcore"."purchase_orders"."taxable" + "radcore"."purchase_orders"."cgst" + "radcore"."purchase_orders"."sgst" + "radcore"."purchase_orders"."igst" + "radcore"."purchase_orders"."round_off"
    and abs("radcore"."purchase_orders"."round_off") < 1 and "radcore"."purchase_orders"."cgst" = "radcore"."purchase_orders"."sgst" and ("radcore"."purchase_orders"."igst" = 0 or "radcore"."purchase_orders"."cgst" = 0)),
	CONSTRAINT "ck_purchase_orders_status" CHECK ("radcore"."purchase_orders"."status" in ('draft', 'placed', 'closed', 'cancelled')),
	CONSTRAINT "ck_purchase_orders_number" CHECK (case "radcore"."purchase_orders"."status" when 'draft' then "radcore"."purchase_orders"."number" is null when 'cancelled' then true
    else "radcore"."purchase_orders"."number" is not null end),
	CONSTRAINT "ck_purchase_orders_reason" CHECK ("radcore"."purchase_orders"."close_reason" is null or "radcore"."purchase_orders"."status" in ('closed', 'cancelled')),
	CONSTRAINT "ck_purchase_orders_cancel_reason" CHECK ("radcore"."purchase_orders"."status" <> 'cancelled' or "radcore"."purchase_orders"."close_reason" is not null),
	CONSTRAINT "ck_purchase_orders_expected" CHECK ("radcore"."purchase_orders"."expected_by" is null or "radcore"."purchase_orders"."expected_by" >= "radcore"."purchase_orders"."business_date")
);
--> statement-breakpoint
ALTER TABLE "radcore"."purchase_order_limits" ADD CONSTRAINT "purchase_order_limits_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "radcore"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_orders" ADD CONSTRAINT "purchase_orders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_purchase_order_lines_line" ON "radcore"."purchase_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_order_lines_item" ON "radcore"."purchase_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_party" ON "radcore"."purchase_orders" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_date" ON "radcore"."purchase_orders" USING btree ("business_date","created_at","id");--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c); none of these columns is personal data. A PO's lines are its parts
-- (ADR-001 §8b): their audit rows carry the PO's id, so maker-checker finds everyone who changed it since its approval
-- was asked for (RC-037).
SELECT radcore.audit_attach('purchase_orders', keep => array['number', 'party_id', 'business_date', 'expected_by', 'status', 'notes',
  'close_reason', 'approved_total', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total']);
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_order_lines', keep => array['order_id', 'line_no', 'item_id', 'qty', 'rate', 'gst_rate',
  'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'],
  owner => 'order_id', owner_table => 'purchase_orders');
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_order_limits', keep => array['role', 'max_total']);
--> statement-breakpoint
-- A placed PO keeps its number: only a draft is deleted (lib-purchasing refuses the rest).
REVOKE TRUNCATE ON radcore.purchase_orders, radcore.purchase_order_lines, radcore.purchase_order_limits FROM radcore_app;
--> statement-breakpoint
-- lib-common's STATE_TRANSITIONS.purchase_orders (ADR-008 §5), held equal by tools/posted-documents.test.ts.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('purchase_orders', 'draft', 'placed'), ('purchase_orders', 'placed', 'closed'), ('purchase_orders', 'draft', 'cancelled'),
  ('purchase_orders', 'placed', 'cancelled');
--> statement-breakpoint
-- The purchasing keys (ADR-008 §13), ordinary catalogue keys any role can be given. The starting grants, in each role's
-- template too (RAD-83): stores drafts and places, accounts reads, the owner reads and approves. The admin holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'purchasing:read', 'all' FROM unnest(array['admin', 'owner', 'stores', 'accounts']) AS r
UNION ALL SELECT r, 'purchasing:write', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'purchasing:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'purchasing:read', 'all' FROM unnest(array['admin', 'owner', 'stores', 'accounts']) AS r
UNION ALL SELECT r, 'purchasing:write', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'purchasing:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
