CREATE TABLE "radcore"."exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"filter" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rows" integer,
	"store_key" text,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_exports_kind" CHECK ("radcore"."exports"."kind" ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_-]*$'),
	CONSTRAINT "ck_exports_status" CHECK ("radcore"."exports"."status" in ('queued', 'ready', 'failed')),
	CONSTRAINT "ck_exports_failure" CHECK (("radcore"."exports"."status" = 'failed') = ("radcore"."exports"."failure" is not null)
    and ("radcore"."exports"."failure" is null or "radcore"."exports"."failure" in ('too_large', 'failed'))),
	CONSTRAINT "ck_exports_ready" CHECK (("radcore"."exports"."status" = 'ready') = ("radcore"."exports"."store_key" is not null)
    and (("radcore"."exports"."status" = 'ready') = ("radcore"."exports"."rows" is not null)) and ("radcore"."exports"."rows" is null or "radcore"."exports"."rows" >= 0)),
	CONSTRAINT "ck_exports_store_key" CHECK ("radcore"."exports"."store_key" is null or "radcore"."exports"."store_key" ~ '^export/[0-9a-f-]{36}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_exports_store_key" ON "radcore"."exports" USING btree ("store_key");--> statement-breakpoint
-- A record people make: audited, with the who-and-when stamp (ADR-005 §5, §7c). The filter may hold a search a
-- person typed, such as a name, so its changes are recorded as redacted.
SELECT radcore.audit_attach('exports', keep => array['kind', 'status', 'rows', 'store_key', 'failure'], redact => array['filter']);