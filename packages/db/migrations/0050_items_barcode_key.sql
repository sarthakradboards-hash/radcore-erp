DROP INDEX "radcore"."ux_items_barcode";--> statement-breakpoint
ALTER TABLE "radcore"."items" ADD COLUMN "barcode_key" text GENERATED ALWAYS AS (upper(barcode)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_items_barcode_key" ON "radcore"."items" USING btree ("barcode_key");
--> statement-breakpoint
-- The new column joins the audit's kept list (ADR-005 §5): a table that gains a column is attached again.
SELECT radcore.audit_attach('items', keep => array['sku', 'sku_key', 'name', 'category_id', 'hsn', 'unit', 'barcode', 'barcode_key', 'serialised', 'has_chassis', 'active']);
