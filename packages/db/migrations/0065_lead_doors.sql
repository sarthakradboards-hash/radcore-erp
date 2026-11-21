CREATE TABLE "radcore"."meta_lead_waits" (
	"leadgen_id" text PRIMARY KEY NOT NULL,
	"form_id" text,
	"page_id" text,
	"delivery_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_meta_lead_waits_leadgen_id" CHECK ("radcore"."meta_lead_waits"."leadgen_id" ~ '^[0-9]{1,30}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."integration_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_integration_secrets_name" CHECK ("radcore"."integration_secrets"."name" ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."meta_lead_waits" ADD CONSTRAINT "meta_lead_waits_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "radcore"."webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_meta_lead_waits_delivery" ON "radcore"."meta_lead_waits" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "ix_meta_lead_waits_waiting" ON "radcore"."meta_lead_waits" USING btree ("received_at") WHERE "radcore"."meta_lead_waits"."fetched_at" is null;--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c). An integration's secret is in the trail only as "changed": its ciphertext
-- is [redacted], like `secrets`' (RAD-42), and only the key that wrapped it is kept.
SELECT radcore.audit_attach('integration_secrets', keep => array['key_id'], redact => array['ciphertext']);
--> statement-breakpoint
SELECT radcore.audit_attach('meta_lead_waits', keep => array['form_id', 'page_id', 'delivery_id', 'received_at', 'fetched_at']);
--> statement-breakpoint
-- The app reads an integration's secret and never writes one: tools/set-secret.ts writes with the owner login (the
-- architect on RAD-107). The read-only login can't see it at all, as with `secrets`.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.integration_secrets FROM radcore_app;
--> statement-breakpoint
REVOKE ALL ON radcore.integration_secrets FROM radcore_read;
--> statement-breakpoint
-- A waiting Meta lead is fetched once (M7) and kept: never deleted.
REVOKE DELETE, TRUNCATE ON radcore.meta_lead_waits FROM radcore_app;
