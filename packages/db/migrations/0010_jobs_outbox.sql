CREATE TABLE "radcore"."jobs_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"principal" text NOT NULL,
	"request_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_jobs_outbox_name" CHECK ("radcore"."jobs_outbox"."name" ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$'),
	CONSTRAINT "ck_jobs_outbox_attempts" CHECK ("radcore"."jobs_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ix_jobs_outbox_due" ON "radcore"."jobs_outbox" USING btree ("next_attempt_at") WHERE "radcore"."jobs_outbox"."dead_at" is null;
--> statement-breakpoint
-- RAD-44: job payloads may be personal (a reset address), so the read-only login never reads them.
REVOKE ALL ON radcore.jobs_outbox FROM radcore_read;
