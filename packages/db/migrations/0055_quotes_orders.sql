CREATE TABLE "radcore"."sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"discount_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_sales_order_lines_qty" CHECK ("radcore"."sales_order_lines"."qty" > 0 and "radcore"."sales_order_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_sales_order_lines_rate" CHECK ("radcore"."sales_order_lines"."rate" >= 0 and "radcore"."sales_order_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_sales_order_lines_discount_percent" CHECK ("radcore"."sales_order_lines"."discount_percent" between 0 and 100 and "radcore"."sales_order_lines"."discount_percent" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"quote_id" uuid,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"close_reason" text,
	"override_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "sales_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "sales_orders_quoteId_unique" UNIQUE("quote_id"),
	CONSTRAINT "ck_sales_orders_notes" CHECK (char_length("radcore"."sales_orders"."notes") <= 500),
	CONSTRAINT "ck_sales_orders_close_reason" CHECK (char_length("radcore"."sales_orders"."close_reason") <= 500),
	CONSTRAINT "ck_sales_orders_status" CHECK ("radcore"."sales_orders"."status" in ('draft', 'confirmed', 'closed', 'cancelled')),
	CONSTRAINT "ck_sales_orders_number" CHECK (("radcore"."sales_orders"."status" = 'draft') = ("radcore"."sales_orders"."number" is null)),
	CONSTRAINT "ck_sales_orders_reason" CHECK ("radcore"."sales_orders"."close_reason" is null or "radcore"."sales_orders"."status" in ('closed', 'cancelled')),
	CONSTRAINT "ck_sales_orders_cancel_reason" CHECK ("radcore"."sales_orders"."status" <> 'cancelled' or "radcore"."sales_orders"."close_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "radcore"."sales_quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"discount_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_sales_quote_lines_qty" CHECK ("radcore"."sales_quote_lines"."qty" > 0 and "radcore"."sales_quote_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_sales_quote_lines_rate" CHECK ("radcore"."sales_quote_lines"."rate" >= 0 and "radcore"."sales_quote_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_sales_quote_lines_discount_percent" CHECK ("radcore"."sales_quote_lines"."discount_percent" between 0 and 100 and "radcore"."sales_quote_lines"."discount_percent" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."sales_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"valid_until" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "sales_quotes_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_sales_quotes_notes" CHECK (char_length("radcore"."sales_quotes"."notes") <= 500),
	CONSTRAINT "ck_sales_quotes_status" CHECK ("radcore"."sales_quotes"."status" in ('draft', 'sent', 'accepted', 'declined', 'expired')),
	CONSTRAINT "ck_sales_quotes_number" CHECK (("radcore"."sales_quotes"."status" = 'draft') = ("radcore"."sales_quotes"."number" is null)),
	CONSTRAINT "ck_sales_quotes_valid_until" CHECK ("radcore"."sales_quotes"."valid_until" is null or "radcore"."sales_quotes"."valid_until" >= "radcore"."sales_quotes"."business_date")
);
--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "sales_orders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "sales_orders_quote_id_sales_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "radcore"."sales_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_quote_id_sales_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "radcore"."sales_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "sales_quotes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sales_order_lines_line" ON "radcore"."sales_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_sales_order_lines_item" ON "radcore"."sales_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_sales_orders_party" ON "radcore"."sales_orders" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_sales_orders_date" ON "radcore"."sales_orders" USING btree ("business_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sales_quote_lines_line" ON "radcore"."sales_quote_lines" USING btree ("quote_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_sales_quote_lines_item" ON "radcore"."sales_quote_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_sales_quotes_party" ON "radcore"."sales_quotes" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_sales_quotes_date" ON "radcore"."sales_quotes" USING btree ("business_date","id");--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c); none of these columns is personal data. A document's lines are its parts
-- (ADR-001 §8b): their audit rows carry the document's id, so maker-checker finds everyone who changed an order since
-- its override was asked for (RC-037).
SELECT radcore.audit_attach('sales_quotes', keep => array['number', 'party_id', 'business_date', 'valid_until', 'status', 'notes']);
--> statement-breakpoint
SELECT radcore.audit_attach('sales_quote_lines', keep => array['quote_id', 'line_no', 'item_id', 'qty', 'rate', 'discount_percent'],
  owner => 'quote_id', owner_table => 'sales_quotes');
--> statement-breakpoint
SELECT radcore.audit_attach('sales_orders', keep => array['number', 'party_id', 'quote_id', 'business_date', 'status', 'notes',
  'close_reason', 'override_version']);
--> statement-breakpoint
SELECT radcore.audit_attach('sales_order_lines', keep => array['order_id', 'line_no', 'item_id', 'qty', 'rate', 'discount_percent'],
  owner => 'order_id', owner_table => 'sales_orders');
--> statement-breakpoint
-- A quote or order that went out keeps its number: only a draft is deleted (lib-sales refuses the rest).
REVOKE TRUNCATE ON radcore.sales_quotes, radcore.sales_quote_lines, radcore.sales_orders, radcore.sales_order_lines FROM radcore_app;
--> statement-breakpoint
-- The sales keys (RAD-112), ordinary catalogue keys any role can be given (Sarthak: dynamic). The starting grants, in
-- each role's template too (RAD-83): those who sell draft and confirm, stores and accounts read, and an override of the
-- credit and price checks is the owner's or accounts' (the architect on RAD-111). The admin holds every key, as it
-- must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'sales:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter', 'stores']) AS r
UNION ALL SELECT r, 'sales:write', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter']) AS r
UNION ALL SELECT r, 'sales:override', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'sales:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter', 'stores']) AS r
UNION ALL SELECT r, 'sales:write', 'all' FROM unnest(array['admin', 'owner', 'sales', 'counter']) AS r
UNION ALL SELECT r, 'sales:override', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
