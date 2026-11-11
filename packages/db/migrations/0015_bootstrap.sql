CREATE TABLE "radcore"."bootstrap" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_bootstrap_key" CHECK ("radcore"."bootstrap"."key" = 'first_admin')
);
--> statement-breakpoint
ALTER TABLE "radcore"."bootstrap" ADD CONSTRAINT "bootstrap_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "radcore"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bootstrap_user_id" ON "radcore"."bootstrap" USING btree ("user_id");
--> statement-breakpoint
-- RAD-32 (ADR-004 §3): the bootstrap record is permanent. The runtime login adds it once and can't change or remove it.
REVOKE UPDATE, DELETE, TRUNCATE ON "radcore"."bootstrap" FROM radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('bootstrap', keep => array['user_id']);
