ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "gst_rate" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "gst_rate_source" text;--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "taxable" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "line_total" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "taxable" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "round_off" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "total" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "gst_rate" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "gst_rate_source" text;--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "taxable" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD COLUMN "line_total" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "taxable" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "round_off" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD COLUMN "total" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_gst_rate" CHECK ("radcore"."sales_order_lines"."gst_rate" between 0 and 100 and "radcore"."sales_order_lines"."gst_rate" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_gst_rate_source" CHECK (char_length("radcore"."sales_order_lines"."gst_rate_source") <= 200);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_taxable" CHECK ("radcore"."sales_order_lines"."taxable" >= 0 and "radcore"."sales_order_lines"."taxable" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_cgst" CHECK ("radcore"."sales_order_lines"."cgst" >= 0 and "radcore"."sales_order_lines"."cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_sgst" CHECK ("radcore"."sales_order_lines"."sgst" >= 0 and "radcore"."sales_order_lines"."sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_igst" CHECK ("radcore"."sales_order_lines"."igst" >= 0 and "radcore"."sales_order_lines"."igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_line_total" CHECK ("radcore"."sales_order_lines"."line_total" >= 0 and "radcore"."sales_order_lines"."line_total" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_frozen" CHECK (num_nulls("radcore"."sales_order_lines"."gst_rate", "radcore"."sales_order_lines"."gst_rate_source", "radcore"."sales_order_lines"."taxable", "radcore"."sales_order_lines"."cgst", "radcore"."sales_order_lines"."sgst", "radcore"."sales_order_lines"."igst", "radcore"."sales_order_lines"."line_total") in (0, 7));--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_identity" CHECK ("radcore"."sales_order_lines"."line_total" = "radcore"."sales_order_lines"."taxable" + "radcore"."sales_order_lines"."cgst" + "radcore"."sales_order_lines"."sgst" + "radcore"."sales_order_lines"."igst"
    and "radcore"."sales_order_lines"."cgst" = "radcore"."sales_order_lines"."sgst" and ("radcore"."sales_order_lines"."igst" = 0 or "radcore"."sales_order_lines"."cgst" = 0));--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_taxable" CHECK ("radcore"."sales_orders"."taxable" >= 0 and "radcore"."sales_orders"."taxable" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_cgst" CHECK ("radcore"."sales_orders"."cgst" >= 0 and "radcore"."sales_orders"."cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_sgst" CHECK ("radcore"."sales_orders"."sgst" >= 0 and "radcore"."sales_orders"."sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_igst" CHECK ("radcore"."sales_orders"."igst" >= 0 and "radcore"."sales_orders"."igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_round_off" CHECK ("radcore"."sales_orders"."round_off" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_total" CHECK ("radcore"."sales_orders"."total" >= 0 and "radcore"."sales_orders"."total" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_frozen" CHECK (num_nulls("radcore"."sales_orders"."place_of_supply", "radcore"."sales_orders"."taxable", "radcore"."sales_orders"."cgst", "radcore"."sales_orders"."sgst", "radcore"."sales_orders"."igst", "radcore"."sales_orders"."round_off", "radcore"."sales_orders"."total") in (0, 7)
    and ("radcore"."sales_orders"."status" = 'draft') = ("radcore"."sales_orders"."total" is null) and coalesce("radcore"."sales_orders"."place_of_supply", '00') ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_identity" CHECK ("radcore"."sales_orders"."total" = "radcore"."sales_orders"."taxable" + "radcore"."sales_orders"."cgst" + "radcore"."sales_orders"."sgst" + "radcore"."sales_orders"."igst" + "radcore"."sales_orders"."round_off"
    and abs("radcore"."sales_orders"."round_off") < 1 and "radcore"."sales_orders"."cgst" = "radcore"."sales_orders"."sgst" and ("radcore"."sales_orders"."igst" = 0 or "radcore"."sales_orders"."cgst" = 0));--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_gst_rate" CHECK ("radcore"."sales_quote_lines"."gst_rate" between 0 and 100 and "radcore"."sales_quote_lines"."gst_rate" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_gst_rate_source" CHECK (char_length("radcore"."sales_quote_lines"."gst_rate_source") <= 200);--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_taxable" CHECK ("radcore"."sales_quote_lines"."taxable" >= 0 and "radcore"."sales_quote_lines"."taxable" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_cgst" CHECK ("radcore"."sales_quote_lines"."cgst" >= 0 and "radcore"."sales_quote_lines"."cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_sgst" CHECK ("radcore"."sales_quote_lines"."sgst" >= 0 and "radcore"."sales_quote_lines"."sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_igst" CHECK ("radcore"."sales_quote_lines"."igst" >= 0 and "radcore"."sales_quote_lines"."igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_line_total" CHECK ("radcore"."sales_quote_lines"."line_total" >= 0 and "radcore"."sales_quote_lines"."line_total" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_frozen" CHECK (num_nulls("radcore"."sales_quote_lines"."gst_rate", "radcore"."sales_quote_lines"."gst_rate_source", "radcore"."sales_quote_lines"."taxable", "radcore"."sales_quote_lines"."cgst", "radcore"."sales_quote_lines"."sgst", "radcore"."sales_quote_lines"."igst", "radcore"."sales_quote_lines"."line_total") in (0, 7));--> statement-breakpoint
ALTER TABLE "radcore"."sales_quote_lines" ADD CONSTRAINT "ck_sales_quote_lines_identity" CHECK ("radcore"."sales_quote_lines"."line_total" = "radcore"."sales_quote_lines"."taxable" + "radcore"."sales_quote_lines"."cgst" + "radcore"."sales_quote_lines"."sgst" + "radcore"."sales_quote_lines"."igst"
    and "radcore"."sales_quote_lines"."cgst" = "radcore"."sales_quote_lines"."sgst" and ("radcore"."sales_quote_lines"."igst" = 0 or "radcore"."sales_quote_lines"."cgst" = 0));--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_taxable" CHECK ("radcore"."sales_quotes"."taxable" >= 0 and "radcore"."sales_quotes"."taxable" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_cgst" CHECK ("radcore"."sales_quotes"."cgst" >= 0 and "radcore"."sales_quotes"."cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_sgst" CHECK ("radcore"."sales_quotes"."sgst" >= 0 and "radcore"."sales_quotes"."sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_igst" CHECK ("radcore"."sales_quotes"."igst" >= 0 and "radcore"."sales_quotes"."igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_round_off" CHECK ("radcore"."sales_quotes"."round_off" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_total" CHECK ("radcore"."sales_quotes"."total" >= 0 and "radcore"."sales_quotes"."total" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_frozen" CHECK (num_nulls("radcore"."sales_quotes"."place_of_supply", "radcore"."sales_quotes"."taxable", "radcore"."sales_quotes"."cgst", "radcore"."sales_quotes"."sgst", "radcore"."sales_quotes"."igst", "radcore"."sales_quotes"."round_off", "radcore"."sales_quotes"."total") in (0, 7)
    and ("radcore"."sales_quotes"."status" = 'draft') = ("radcore"."sales_quotes"."total" is null) and coalesce("radcore"."sales_quotes"."place_of_supply", '00') ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "radcore"."sales_quotes" ADD CONSTRAINT "ck_sales_quotes_identity" CHECK ("radcore"."sales_quotes"."total" = "radcore"."sales_quotes"."taxable" + "radcore"."sales_quotes"."cgst" + "radcore"."sales_quotes"."sgst" + "radcore"."sales_quotes"."igst" + "radcore"."sales_quotes"."round_off"
    and abs("radcore"."sales_quotes"."round_off") < 1 and "radcore"."sales_quotes"."cgst" = "radcore"."sales_quotes"."sgst" and ("radcore"."sales_quotes"."igst" = 0 or "radcore"."sales_quotes"."cgst" = 0));
--> statement-breakpoint
-- Part of RAD-112 (the architect on RAD-112, ruled on RAD-125): what a quote and an order freeze when sent or confirmed,
-- their lines' GST rates, tax and totals, kept in the audit trail with the rest of each row (attached again, as 0059 did).
SELECT radcore.audit_attach('sales_quotes', keep => array['number', 'party_id', 'business_date', 'valid_until', 'status', 'notes',
  'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total']);
--> statement-breakpoint
SELECT radcore.audit_attach('sales_quote_lines', keep => array['quote_id', 'line_no', 'item_id', 'qty', 'rate', 'discount_percent',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'], owner => 'quote_id', owner_table => 'sales_quotes');
--> statement-breakpoint
SELECT radcore.audit_attach('sales_orders', keep => array['number', 'party_id', 'price_list_id', 'quote_id', 'business_date', 'status',
  'notes', 'close_reason', 'override_version', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total']);
--> statement-breakpoint
SELECT radcore.audit_attach('sales_order_lines', keep => array['order_id', 'line_no', 'item_id', 'qty', 'rate', 'discount_percent',
  'list_rate', 'list_version_id', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'],
  owner => 'order_id', owner_table => 'sales_orders');
