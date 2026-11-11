CREATE TABLE "radcore"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"delivery_id" text NOT NULL,
	"payload" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_webhook_deliveries_source_delivery_id" ON "radcore"."webhook_deliveries" USING btree ("source","delivery_id");--> statement-breakpoint
CREATE INDEX "ix_webhook_deliveries_unprocessed" ON "radcore"."webhook_deliveries" USING btree ("created_at") WHERE "radcore"."webhook_deliveries"."processed_at" is null;
--> statement-breakpoint
-- RAD-45: payloads may be personal (an order's customer), so the read-only login never reads them.
REVOKE ALL ON radcore.webhook_deliveries FROM radcore_read;
