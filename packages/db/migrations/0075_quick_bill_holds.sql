CREATE TABLE "radcore"."quick_bill_holds" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"payments" json NOT NULL,
	"picks" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radcore"."quick_bill_holds" ADD CONSTRAINT "quick_bill_holds_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."quick_bill_holds" ADD CONSTRAINT "quick_bill_holds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_quick_bill_holds_location" ON "radcore"."quick_bill_holds" USING btree ("location_id");--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c).
SELECT radcore.audit_attach('quick_bill_holds', keep => array['order_id', 'location_id', 'payments', 'picks']);
