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
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "ck_sales_orders_override_after" CHECK ("radcore"."sales_orders"."override_after" <> 'NaN');