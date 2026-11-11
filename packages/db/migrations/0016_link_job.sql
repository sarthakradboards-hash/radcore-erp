ALTER TABLE "radcore"."invites" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."invites" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radcore"."password_resets" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."password_resets" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invites_job_id" ON "radcore"."invites" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_password_resets_job_id" ON "radcore"."password_resets" USING btree ("job_id");
--> statement-breakpoint
-- Both tables gained columns, so their audit triggers are attached again with them (RAD-30, ADR-005 §5).
SELECT radcore.audit_attach('invites', keep => array['user_id', 'expires_at', 'used_at', 'job_id', 'sent_at'], redact => array['token_hash']);
--> statement-breakpoint
SELECT radcore.audit_attach('password_resets', keep => array['user_id', 'expires_at', 'used_at', 'job_id', 'sent_at'], redact => array['token_hash']);
