CREATE TABLE "radcore"."files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"store_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_files_filename" CHECK (char_length("radcore"."files"."filename") <= 255),
	CONSTRAINT "ck_files_kind" CHECK ("radcore"."files"."kind" in ('photo', 'resume', 'statement', 'import')),
	CONSTRAINT "ck_files_status" CHECK ("radcore"."files"."status" in ('pending', 'checking', 'ready', 'refused')),
	CONSTRAINT "ck_files_store_key" CHECK ("radcore"."files"."store_key" ~ ('^' || "radcore"."files"."kind" || '/[0-9a-f-]{36}$')),
	CONSTRAINT "ck_files_size" CHECK (("radcore"."files"."status" <> 'ready' or "radcore"."files"."size" is not null) and ("radcore"."files"."size" is null or "radcore"."files"."size" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_files_store_key" ON "radcore"."files" USING btree ("store_key");--> statement-breakpoint
-- A record people make: audited, with the who-and-when stamp (ADR-005 §5, §7c). The name a person gave the file
-- often holds a person's name, so its changes are recorded as redacted (auditor-2).
SELECT radcore.audit_attach('files', keep => array['kind', 'store_key', 'content_type', 'size', 'status'], redact => array['filename']);
