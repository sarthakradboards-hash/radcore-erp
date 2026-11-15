CREATE TABLE "radcore"."item_pictures" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_item_pictures_position" CHECK ("radcore"."item_pictures"."position" between 0 and 7)
);
--> statement-breakpoint
ALTER TABLE "radcore"."files" DROP CONSTRAINT "ck_files_kind";--> statement-breakpoint
ALTER TABLE "radcore"."item_pictures" ADD CONSTRAINT "item_pictures_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."item_pictures" ADD CONSTRAINT "item_pictures_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_item_pictures_item_position" ON "radcore"."item_pictures" USING btree ("item_id","position");--> statement-breakpoint
ALTER TABLE "radcore"."files" ADD CONSTRAINT "ck_files_kind" CHECK ("radcore"."files"."kind" in ('photo', 'resume', 'statement', 'import', 'item_picture'));
--> statement-breakpoint
-- Audited like every table (ADR-005 §5): which picture went on or came off which item, and who did it (RAD-89).
SELECT radcore.audit_attach('item_pictures', keep => array['item_id', 'position']);
