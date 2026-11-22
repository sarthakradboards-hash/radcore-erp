ALTER TABLE "radcore"."quick_bill_holds" DROP CONSTRAINT "ck_quick_bill_holds_approved_after";--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD COLUMN "override_after" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD COLUMN "override_after" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "override_after" numeric(18, 2);--> statement-breakpoint
-- A held bill's approved figure moves to its order (the architect on RAD-135), before the hold's column goes.
UPDATE "radcore"."sales_orders" o SET "override_after" = h."approved_after" FROM "radcore"."quick_bill_holds" h
  WHERE h."order_id" = o."id" AND h."approved_after" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."quick_bill_holds" DROP COLUMN "approved_after";--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "ck_deliveries_override_after" CHECK ("radcore"."deliveries"."override_after" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "ck_invoices_override_after" CHECK ("radcore"."invoices"."override_after" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_override_after" CHECK ("radcore"."sales_orders"."override_after" <> 'NaN');--> statement-breakpoint
-- Attached again with override_after kept (ADR-005 §5): what an approval held for is part of the document's trail.
SELECT radcore.audit_attach('sales_orders', keep => array['number', 'party_id', 'price_list_id', 'quote_id', 'business_date', 'status',
  'notes', 'close_reason', 'override_version', 'override_after', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total']);
--> statement-breakpoint
SELECT radcore.audit_attach('deliveries', keep => array['status', 'number', 'order_id', 'party_id', 'owner', 'location_id', 'business_date',
  'notes', 'override_version', 'override_after', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('invoices',
  keep => array['status', 'number', 'party_id', 'owner', 'price_list_id', 'business_date', 'notes', 'ship_to_name', 'ship_to_state_code', 'issuer_legal_name',
    'issuer_gstin', 'issuer_address_line1', 'issuer_address_line2', 'issuer_city', 'issuer_pincode', 'issuer_state_code', 'buyer_name',
    'buyer_gstin', 'buyer_state_code', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'round_off', 'total',
    'override_version', 'override_after', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id'],
  redact => array['ship_to_address', 'buyer_address_line1', 'buyer_address_line2', 'buyer_city', 'buyer_pincode']);
--> statement-breakpoint
-- The hold's approved_after went to its order above, so it's no longer kept.
SELECT radcore.audit_attach('quick_bill_holds', keep => array['order_id', 'location_id', 'payments', 'picks']);
