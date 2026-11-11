CREATE TABLE "radcore"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"record_id" uuid NOT NULL,
	"version_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_approvals_reason" CHECK (char_length("radcore"."approvals"."reason") <= 500),
	CONSTRAINT "ck_approvals_kind" CHECK ("radcore"."approvals"."kind" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "ck_approvals_version_hash" CHECK ("radcore"."approvals"."version_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_approvals_status" CHECK ("radcore"."approvals"."status" in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "ck_approvals_decided" CHECK (("radcore"."approvals"."status" = 'pending') = ("radcore"."approvals"."decided_at" is null)
    and ("radcore"."approvals"."status" in ('approved', 'rejected')) = ("radcore"."approvals"."decided_by" is not null)
    and ("radcore"."approvals"."decided_by" is null or "radcore"."approvals"."decided_by" <> "radcore"."approvals"."requested_by"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_approvals_pending" ON "radcore"."approvals" USING btree ("kind","record_id") WHERE "radcore"."approvals"."decided_at" is null;--> statement-breakpoint
CREATE INDEX "ix_approvals_kind_status" ON "radcore"."approvals" USING btree ("kind","status","created_at");--> statement-breakpoint
-- A record people make (ADR-005 §5, §7c): audited, every column kept, since who asked, who decided and what they
-- decided on is the point of the table (RC-037).
SELECT radcore.audit_attach('approvals', keep => array['kind', 'record_id', 'version_hash', 'requested_by', 'status', 'decided_by', 'decided_at', 'reason']);
