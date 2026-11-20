CREATE TABLE "radcore"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"tds" numeric(18, 2) DEFAULT '0' NOT NULL,
	"account_id" uuid NOT NULL,
	"refund_of_id" uuid,
	"narration" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "payments_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_payments_amount" CHECK ("radcore"."payments"."amount" >= 0 and "radcore"."payments"."amount" <> 'NaN'),
	CONSTRAINT "ck_payments_tds" CHECK ("radcore"."payments"."tds" >= 0 and "radcore"."payments"."tds" <> 'NaN'),
	CONSTRAINT "ck_payments_narration" CHECK (char_length("radcore"."payments"."narration") <= 500),
	CONSTRAINT "ck_payments_cancel_reason" CHECK (char_length("radcore"."payments"."cancel_reason") <= 500),
	CONSTRAINT "ck_payments_kind" CHECK ("radcore"."payments"."kind" in ('receipt', 'payment', 'refund')),
	CONSTRAINT "ck_payments_status" CHECK ("radcore"."payments"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_payments_figures" CHECK ("radcore"."payments"."amount" > 0 and "radcore"."payments"."tds" < "radcore"."payments"."amount"),
	CONSTRAINT "ck_payments_refund" CHECK (("radcore"."payments"."kind" = 'refund') = ("radcore"."payments"."refund_of_id" is not null) and ("radcore"."payments"."kind" <> 'refund' or "radcore"."payments"."tds" = 0)),
	CONSTRAINT "ck_payments_posted" CHECK (("radcore"."payments"."status" = 'draft') = ("radcore"."payments"."number" is null) and ("radcore"."payments"."status" = 'draft') = ("radcore"."payments"."posted_entry_id" is null)),
	CONSTRAINT "ck_payments_cancelled" CHECK (("radcore"."payments"."status" = 'cancelled') = ("radcore"."payments"."cancel_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "payments_refund_of_id_payments_id_fk" FOREIGN KEY ("refund_of_id") REFERENCES "radcore"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "payments_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "payments_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_payments_party_date" ON "radcore"."payments" USING btree ("party_id","business_date");--> statement-breakpoint
CREATE INDEX "ix_payments_refund_of" ON "radcore"."payments" USING btree ("refund_of_id");--> statement-breakpoint
CREATE INDEX "ix_payments_account" ON "radcore"."payments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_payments_posted_entry" ON "radcore"."payments" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_payments_cancel_entry" ON "radcore"."payments" USING btree ("cancel_entry_id");--> statement-breakpoint
-- Receipts, payments and refunds are posted documents (ADR-007 §1, §2; ADR-005 §7b): draft -> posted -> cancelled,
-- cancelled final. While a draft, anything changes; after posting, only the move to cancelled and its cancel columns.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('payments', 'draft', 'posted'), ('payments', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.payments
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
-- A money document is audited in full: every column kept.
SELECT radcore.audit_attach('payments', keep => array['kind', 'status', 'number', 'party_id', 'business_date', 'amount', 'tds',
  'account_id', 'refund_of_id', 'narration', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
-- The payments keys (RAD-116), ordinary catalogue keys any role can be given, in each role and its template. Recording
-- moves money and approving overrides a cash limit, so both need the second factor (D-19).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'payments:write', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'payments:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'payments:write', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'payments:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
