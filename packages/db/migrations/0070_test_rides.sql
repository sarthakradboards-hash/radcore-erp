CREATE TABLE "radcore"."test_rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"outcome" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_test_rides_serial_no" CHECK (char_length("radcore"."test_rides"."serial_no") <= 60),
	CONSTRAINT "ck_test_rides_note" CHECK (char_length("radcore"."test_rides"."note") <= 2000),
	CONSTRAINT "ck_test_rides_outcome" CHECK ("radcore"."test_rides"."outcome" in ('liked', 'not_interested', 'wants_another', 'no_show', 'cancelled')),
	CONSTRAINT "ck_test_rides_done" CHECK (("radcore"."test_rides"."done_at" is null) = ("radcore"."test_rides"."outcome" is null)),
	CONSTRAINT "ck_test_rides_serial" CHECK ("radcore"."test_rides"."serial_no" ~ '^[ -~]*[!-~][ -~]*$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."files" DROP CONSTRAINT "ck_files_kind";--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD COLUMN "checklist_inspected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD COLUMN "checklist_briefed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD COLUMN "checklist_warranty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD COLUMN "checklist_photo_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD COLUMN "checklist_note_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."test_rides" ADD CONSTRAINT "test_rides_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "radcore"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."test_rides" ADD CONSTRAINT "test_rides_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_test_rides_lead" ON "radcore"."test_rides" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ix_test_rides_item" ON "radcore"."test_rides" USING btree ("item_id","scheduled_at");--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_checklist_photo_id_files_id_fk" FOREIGN KEY ("checklist_photo_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_checklist_note_id_files_id_fk" FOREIGN KEY ("checklist_note_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_vehicle_bookings_checklist_photo" ON "radcore"."vehicle_bookings" USING btree ("checklist_photo_id");--> statement-breakpoint
CREATE INDEX "ix_vehicle_bookings_checklist_note" ON "radcore"."vehicle_bookings" USING btree ("checklist_note_id");--> statement-breakpoint
ALTER TABLE "radcore"."files" ADD CONSTRAINT "ck_files_kind" CHECK ("radcore"."files"."kind" in ('photo', 'resume', 'statement', 'import', 'item_picture', 'delivery_photo', 'delivery_note'));--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c).
SELECT radcore.audit_attach('test_rides', keep => array['lead_id', 'item_id', 'serial_no', 'scheduled_at', 'done_at', 'outcome', 'note']);
--> statement-breakpoint
-- The checklist columns join the booking's kept list (ADR-005 §5): a table that gains a column is attached again.
SELECT radcore.audit_attach('vehicle_bookings', keep => array['number', 'order_id', 'order_line_id', 'item_id', 'serial_no',
  'lead_id', 'business_date', 'status', 'cancel_reason', 'cancelled_on', 'checklist_inspected', 'checklist_briefed',
  'checklist_warranty', 'checklist_photo_id', 'checklist_note_id']);
--> statement-breakpoint
-- A ride is kept for good, its outcome too: the lead's history reads it.
REVOKE DELETE, TRUNCATE ON radcore.test_rides FROM radcore_app;
