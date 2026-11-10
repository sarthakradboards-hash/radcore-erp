CREATE TABLE "radcore"."saved_once" (
	"principal" text NOT NULL,
	"route" text NOT NULL,
	"key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"answer" jsonb,
	"kept" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_saved_once" PRIMARY KEY("principal","route","key"),
	CONSTRAINT "ck_saved_once_input_hash" CHECK ("radcore"."saved_once"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "ix_saved_once_expires_at" ON "radcore"."saved_once" USING btree ("expires_at");