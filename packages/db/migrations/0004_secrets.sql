CREATE TABLE "radcore"."secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_secrets_name" CHECK ("radcore"."secrets"."name" ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE INDEX "ix_secrets_expires_at" ON "radcore"."secrets" USING btree ("expires_at") WHERE "radcore"."secrets"."expires_at" is not null;
--> statement-breakpoint
-- RAD-65: the read-only login (restore drill, support queries) never sees a stored secret, even encrypted.
REVOKE ALL ON radcore.secrets FROM radcore_read;
