ALTER TABLE "radcore"."journal_lines" ADD COLUMN "signed_amount" numeric(18, 2) GENERATED ALWAYS AS (debit - credit) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_journal_lines_bank_candidates" ON "radcore"."journal_lines" USING btree ("account_id","signed_amount","business_date");--> statement-breakpoint
ALTER TABLE "radcore"."journal_lines" ADD CONSTRAINT "ck_journal_lines_signed_amount" CHECK ("radcore"."journal_lines"."signed_amount" <> 'NaN');--> statement-breakpoint
-- RAD-165 (M5-13; ADR-009 §12): auto-match reads a bank line's candidates by account, signed amount and date in one
-- indexed read. The generated column is kept in the trail like the rest of a line.
SELECT radcore.audit_attach('journal_lines', keep => array['entry_id', 'line_no', 'entry_kind', 'business_date', 'posted_at',
  'fy_start', 'account_id', 'account_control_kind', 'rule_kind', 'debit', 'credit', 'party_id', 'item_id', 'location_id', 'signed_amount']);
