CREATE TABLE "radcore"."filing_undo_requests" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"through_was" date,
	"applied_at" timestamp with time zone,
	CONSTRAINT "ck_filing_undo_requests_reason" CHECK (char_length("radcore"."filing_undo_requests"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "radcore"."filing_undo_requests" ADD CONSTRAINT "filing_undo_requests_filing_id_gst_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "radcore"."gst_filings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_filing_undo_requests_filing" ON "radcore"."filing_undo_requests" USING btree ("filing_id");--> statement-breakpoint
-- RAD-156 PR 2 (ADR-009 §5, D-06): undoing a filing. A request is written once; its approval only stamps applied_at.
-- UPDATE on that column alone, which also lets the service lock the row FOR UPDATE.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.filing_undo_requests FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (applied_at) ON radcore.filing_undo_requests TO radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('filing_undo_requests', keep => array['filing_id', 'reason', 'through_was', 'applied_at']);
