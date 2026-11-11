ALTER TABLE "radcore"."invites" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."invites" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radcore"."password_resets" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."password_resets" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invites_job_id" ON "radcore"."invites" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_password_resets_job_id" ON "radcore"."password_resets" USING btree ("job_id");