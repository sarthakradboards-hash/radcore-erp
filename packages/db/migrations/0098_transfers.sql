CREATE TABLE "radcore"."transfers" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reference" text,
	"notes" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "transfers_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_transfers_amount" CHECK ("radcore"."transfers"."amount" >= 0 and "radcore"."transfers"."amount" <> 'NaN'),
	CONSTRAINT "ck_transfers_reference" CHECK (char_length("radcore"."transfers"."reference") <= 40),
	CONSTRAINT "ck_transfers_notes" CHECK (char_length("radcore"."transfers"."notes") <= 500),
	CONSTRAINT "ck_transfers_cancel_reason" CHECK (char_length("radcore"."transfers"."cancel_reason") <= 500),
	CONSTRAINT "ck_transfers_status" CHECK ("radcore"."transfers"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_transfers_figures" CHECK ("radcore"."transfers"."amount" > 0 and "radcore"."transfers"."from_account_id" <> "radcore"."transfers"."to_account_id"),
	CONSTRAINT "ck_transfers_posted" CHECK (("radcore"."transfers"."status" = 'draft') = ("radcore"."transfers"."number" is null) and ("radcore"."transfers"."status" = 'draft') = ("radcore"."transfers"."posted_entry_id" is null)),
	CONSTRAINT "ck_transfers_cancelled" CHECK (("radcore"."transfers"."status" = 'cancelled') = ("radcore"."transfers"."cancel_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."transfers" ADD CONSTRAINT "transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."transfers" ADD CONSTRAINT "transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."transfers" ADD CONSTRAINT "transfers_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."transfers" ADD CONSTRAINT "transfers_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_transfers_date" ON "radcore"."transfers" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_transfers_from" ON "radcore"."transfers" USING btree ("from_account_id");--> statement-breakpoint
CREATE INDEX "ix_transfers_to" ON "radcore"."transfers" USING btree ("to_account_id");--> statement-breakpoint
CREATE INDEX "ix_transfers_posted_entry" ON "radcore"."transfers" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_transfers_cancel_entry" ON "radcore"."transfers" USING btree ("cancel_entry_id");--> statement-breakpoint
-- RAD-165 (the architect on RAD-168; ADR-006 §6, F19): transfers between our own money accounts are posted documents
-- (ADR-005 §7b): draft -> posted -> cancelled, cancelled final. After posting, only the move to cancelled and its cancel
-- columns change. lib-common's STATE_TRANSITIONS holds the same, and tools/posted-documents.test.ts the two equal.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('transfers', 'draft', 'posted'), ('transfers', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.transfers
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
-- A money document is audited in full: every column kept.
SELECT radcore.audit_attach('transfers', keep => array['status', 'number', 'business_date', 'from_account_id', 'to_account_id', 'amount',
  'reference', 'notes', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
REVOKE TRUNCATE ON radcore.transfers FROM radcore_app;
