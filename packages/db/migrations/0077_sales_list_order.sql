DROP INDEX "radcore"."ix_deliveries_date";--> statement-breakpoint
DROP INDEX "radcore"."ix_delivery_returns_date";--> statement-breakpoint
DROP INDEX "radcore"."ix_invoices_date";--> statement-breakpoint
DROP INDEX "radcore"."ix_sales_orders_date";--> statement-breakpoint
DROP INDEX "radcore"."ix_sales_quotes_date";--> statement-breakpoint
DROP INDEX "radcore"."ix_credit_notes_date";--> statement-breakpoint
CREATE INDEX "ix_deliveries_date" ON "radcore"."deliveries" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_date" ON "radcore"."delivery_returns" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_invoices_date" ON "radcore"."invoices" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_sales_orders_date" ON "radcore"."sales_orders" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_sales_quotes_date" ON "radcore"."sales_quotes" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_date" ON "radcore"."credit_notes" USING btree ("business_date","created_at","id");