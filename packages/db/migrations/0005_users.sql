CREATE TABLE "radcore"."invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_invites_token_hash" CHECK ("radcore"."invites"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_password_resets_token_hash" CHECK ("radcore"."password_resets"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_key" text GENERATED ALWAYS AS (lower(btrim(email))) STORED NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_users_email" CHECK (char_length("radcore"."users"."email") <= 254),
	CONSTRAINT "ck_users_display_name" CHECK (char_length("radcore"."users"."display_name") <= 120),
	CONSTRAINT "ck_users_status" CHECK ("radcore"."users"."status" in ('invited', 'active', 'disabled')),
	CONSTRAINT "ck_users_password" CHECK (("radcore"."users"."status" = 'invited') = ("radcore"."users"."password_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."invites" ADD CONSTRAINT "invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invites_token_hash" ON "radcore"."invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_invites_user_id" ON "radcore"."invites" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_password_resets_token_hash" ON "radcore"."password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_password_resets_user_id" ON "radcore"."password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email_key" ON "radcore"."users" USING btree ("email_key");
--> statement-breakpoint
-- RAD-32: the read-only login (support, the restore drill) never sees a password hash or a link token's hash.
REVOKE SELECT ON "radcore"."invites", "radcore"."password_resets" FROM radcore_read;--> statement-breakpoint
REVOKE SELECT ON "radcore"."users" FROM radcore_read;--> statement-breakpoint
GRANT SELECT ("id", "email", "email_key", "display_name", "password_set_at", "status", "created_at", "created_by", "updated_at", "updated_by") ON "radcore"."users" TO radcore_read;
