ALTER TABLE "radcore"."users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radcore"."users" ADD COLUMN "last_sign_in_sort" timestamp with time zone GENERATED ALWAYS AS (coalesce(last_sign_in_at, timestamptz 'epoch')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_users_last_sign_in" ON "radcore"."users" USING btree ("last_sign_in_sort","id");
--> statement-breakpoint
-- RAD-36: users gained columns, so its audit trigger is attached again with them (RAD-30). A sign-in's time is no
-- secret, and the security events already record each sign-in (RAD-31).
SELECT radcore.audit_attach('users', keep => array['status', 'password_set_at', 'role', 'role_since', 'last_sign_in_at', 'last_sign_in_sort'],
  redact => array['email', 'email_key', 'display_name', 'password_hash']);
--> statement-breakpoint
-- The read-only login sees users column by column (0005); these two join what it may read.
GRANT SELECT ("last_sign_in_at", "last_sign_in_sort") ON "radcore"."users" TO radcore_read;
