CREATE TABLE "radcore"."public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"record_table" text NOT NULL,
	"record_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uses_left" integer,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_public_links_action" CHECK ("radcore"."public_links"."action" ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service).[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_public_links_token_hash" CHECK ("radcore"."public_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_public_links_record_table" CHECK ("radcore"."public_links"."record_table" ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || "radcore"."public_links"."record_table") is not null),
	CONSTRAINT "ck_public_links_uses_left" CHECK ("radcore"."public_links"."uses_left" is null or "radcore"."public_links"."uses_left" >= 0),
	CONSTRAINT "ck_public_links_revoked" CHECK (("radcore"."public_links"."revoked_at" is null) = ("radcore"."public_links"."revoked_by" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_public_links_token_hash" ON "radcore"."public_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_public_links_action_record_id" ON "radcore"."public_links" USING btree ("action","record_id");--> statement-breakpoint
-- RAD-41: the read-only login (support, the restore drill) sees links, never their token's hash.
REVOKE SELECT ON "radcore"."public_links" FROM radcore_read;--> statement-breakpoint
GRANT SELECT ("id", "action", "record_table", "record_id", "expires_at", "uses_left", "revoked_at", "revoked_by", "created_at", "created_by", "updated_at", "updated_by") ON "radcore"."public_links" TO radcore_read;
--> statement-breakpoint
-- A record people make (ADR-005 §5, §7c): audited, with the token's hash redacted, so the log says only that it changed.
SELECT radcore.audit_attach('public_links', keep => array['action', 'record_table', 'record_id', 'expires_at', 'uses_left', 'revoked_at', 'revoked_by'], redact => array['token_hash']);
