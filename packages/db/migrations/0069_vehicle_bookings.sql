CREATE TABLE "radcore"."vehicle_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text NOT NULL,
	"lead_id" uuid,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"cancel_reason" text,
	"cancelled_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "vehicle_bookings_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_vehicle_bookings_serial_no" CHECK (char_length("radcore"."vehicle_bookings"."serial_no") <= 60),
	CONSTRAINT "ck_vehicle_bookings_cancel_reason" CHECK (char_length("radcore"."vehicle_bookings"."cancel_reason") <= 500),
	CONSTRAINT "ck_vehicle_bookings_status" CHECK ("radcore"."vehicle_bookings"."status" in ('booked', 'delivered', 'cancelled')),
	CONSTRAINT "ck_vehicle_bookings_cancelled" CHECK (("radcore"."vehicle_bookings"."status" = 'cancelled') = ("radcore"."vehicle_bookings"."cancel_reason" is not null) and ("radcore"."vehicle_bookings"."status" = 'cancelled') = ("radcore"."vehicle_bookings"."cancelled_on" is not null)),
	CONSTRAINT "ck_vehicle_bookings_serial" CHECK ("radcore"."vehicle_bookings"."serial_no" ~ '^[ -~]*[!-~][ -~]*$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "radcore"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "radcore"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_vehicle_bookings_live_line" ON "radcore"."vehicle_bookings" USING btree ("order_line_id") WHERE "radcore"."vehicle_bookings"."cancelled_on" is null;--> statement-breakpoint
CREATE INDEX "ix_vehicle_bookings_order" ON "radcore"."vehicle_bookings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_vehicle_bookings_item" ON "radcore"."vehicle_bookings" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_vehicle_bookings_lead" ON "radcore"."vehicle_bookings" USING btree ("lead_id");--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c).
SELECT radcore.audit_attach('vehicle_bookings', keep => array['number', 'order_id', 'order_line_id', 'item_id', 'serial_no',
  'lead_id', 'business_date', 'status', 'cancel_reason', 'cancelled_on']);
--> statement-breakpoint
-- A booking is kept for good, cancelled or not: its advance's receipts name it (held_for).
REVOKE DELETE, TRUNCATE ON radcore.vehicle_bookings FROM radcore_app;
--> statement-breakpoint
-- The bookings keys (RAD-117, the architect's rulings), ordinary catalogue keys any role can be given, in each role's
-- template too (RAD-83). Sales and the counter book their own; admin, owner and accounts every booking, and accounts
-- refund from cancelled ones later. The refund keys, which need the second factor (D-19), start with admin, owner and
-- accounts.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, k, 'own' FROM unnest(array['sales', 'counter']) AS r, unnest(array['bookings:read', 'bookings:write']) AS k
UNION ALL SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r,
  unnest(array['bookings:read', 'bookings:write', 'bookings:refund_full', 'bookings:refund_part']) AS k
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission LIKE 'bookings:%'
ON CONFLICT DO NOTHING;
