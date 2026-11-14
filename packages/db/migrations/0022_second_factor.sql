CREATE TABLE "radcore"."pending_sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_pending_sign_ins_token_hash" CHECK ("radcore"."pending_sign_ins"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radcore"."second_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"secret_key_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radcore"."pending_sign_ins" ADD CONSTRAINT "pending_sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."second_factors" ADD CONSTRAINT "second_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pending_sign_ins_token_hash" ON "radcore"."pending_sign_ins" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_pending_sign_ins_user_id" ON "radcore"."pending_sign_ins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_recovery_codes_user_id" ON "radcore"."recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_second_factors_user_id" ON "radcore"."second_factors" USING btree ("user_id");--> statement-breakpoint
-- RAD-33 (M1-15): audited, with the secret, the hashes and the last-used step written as [redacted] (RAD-30). Whether a
-- factor was enrolled, removed or given new codes is also a security event (RAD-31).
SELECT radcore.audit_attach('second_factors', keep => array['user_id', 'confirmed_at'], redact => array['secret', 'secret_key_id', 'last_step']);
--> statement-breakpoint
SELECT radcore.audit_attach('recovery_codes', keep => array['user_id', 'used_at'], redact => array['code_hash']);
--> statement-breakpoint
SELECT radcore.audit_attach('pending_sign_ins', keep => array['user_id', 'expires_at', 'used_at'], redact => array['token_hash']);
--> statement-breakpoint
-- Like invites and password resets, the read-only login sees none of these: they are how someone signs in.
REVOKE SELECT ON "radcore"."second_factors", "radcore"."recovery_codes", "radcore"."pending_sign_ins" FROM radcore_read;
