ALTER TABLE "radcore"."items" ADD COLUMN "purchase_price" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "radcore"."items" ADD CONSTRAINT "ck_items_purchase_price" CHECK ("radcore"."items"."purchase_price" >= 0 and "radcore"."items"."purchase_price" <> 'NaN');--> statement-breakpoint
-- The new column joins the audit's kept list (ADR-005 §5): a cost is kept, not redacted, and the audit trail masks it
-- for a viewer without cost:read (COST_COLUMNS, ADR-001 §7a).
SELECT radcore.audit_attach('items', keep => array['sku', 'sku_key', 'name', 'category_id', 'hsn', 'unit', 'barcode', 'barcode_key', 'serialised', 'has_chassis', 'active', 'purchase_price']);
