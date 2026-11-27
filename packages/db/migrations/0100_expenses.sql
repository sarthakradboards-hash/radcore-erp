CREATE TABLE "radcore"."expense_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text,
	"taxable" numeric(18, 2) NOT NULL,
	"gst_rate" numeric(9, 6) NOT NULL,
	"cgst" numeric(18, 2) NOT NULL,
	"sgst" numeric(18, 2) NOT NULL,
	"igst" numeric(18, 2) NOT NULL,
	"credit_cgst" numeric(18, 2),
	"credit_sgst" numeric(18, 2),
	"credit_igst" numeric(18, 2),
	"credit_reason" text,
	CONSTRAINT "ck_expense_lines_description" CHECK (char_length("radcore"."expense_lines"."description") <= 100),
	CONSTRAINT "ck_expense_lines_taxable" CHECK ("radcore"."expense_lines"."taxable" >= 0 and "radcore"."expense_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_gst_rate" CHECK ("radcore"."expense_lines"."gst_rate" between 0 and 100 and "radcore"."expense_lines"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_cgst" CHECK ("radcore"."expense_lines"."cgst" >= 0 and "radcore"."expense_lines"."cgst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_sgst" CHECK ("radcore"."expense_lines"."sgst" >= 0 and "radcore"."expense_lines"."sgst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_igst" CHECK ("radcore"."expense_lines"."igst" >= 0 and "radcore"."expense_lines"."igst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_credit_cgst" CHECK ("radcore"."expense_lines"."credit_cgst" >= 0 and "radcore"."expense_lines"."credit_cgst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_credit_sgst" CHECK ("radcore"."expense_lines"."credit_sgst" >= 0 and "radcore"."expense_lines"."credit_sgst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_credit_igst" CHECK ("radcore"."expense_lines"."credit_igst" >= 0 and "radcore"."expense_lines"."credit_igst" <> 'NaN'),
	CONSTRAINT "ck_expense_lines_heads" CHECK ("radcore"."expense_lines"."cgst" = "radcore"."expense_lines"."sgst" and ("radcore"."expense_lines"."igst" = 0 or "radcore"."expense_lines"."cgst" = 0)),
	CONSTRAINT "ck_expense_lines_credit" CHECK (num_nulls("radcore"."expense_lines"."credit_cgst", "radcore"."expense_lines"."credit_sgst", "radcore"."expense_lines"."credit_igst") in (0, 3)
    and ("radcore"."expense_lines"."credit_reason" is null or "radcore"."expense_lines"."credit_cgst" is not null)),
	CONSTRAINT "ck_expense_lines_credit_whole" CHECK ("radcore"."expense_lines"."credit_cgst" is null
    or ("radcore"."expense_lines"."credit_reason" is null and "radcore"."expense_lines"."credit_cgst" = "radcore"."expense_lines"."cgst" and "radcore"."expense_lines"."credit_sgst" = "radcore"."expense_lines"."sgst" and "radcore"."expense_lines"."credit_igst" = "radcore"."expense_lines"."igst")
    or ("radcore"."expense_lines"."credit_reason" in ('supplier_kind', 'blocked', 'state') and "radcore"."expense_lines"."credit_cgst" = 0 and "radcore"."expense_lines"."credit_sgst" = 0 and "radcore"."expense_lines"."credit_igst" = 0))
);
--> statement-breakpoint
CREATE TABLE "radcore"."expenses" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"party_id" uuid,
	"supplier_invoice_number" text NOT NULL,
	"supplier_invoice_date" date NOT NULL,
	"supplier_gstin" text,
	"pay_from_account_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"stated_total" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"file_id" uuid,
	"notes" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "expenses_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_expenses_supplier_invoice_number" CHECK (char_length("radcore"."expenses"."supplier_invoice_number") <= 40),
	CONSTRAINT "ck_expenses_stated_total" CHECK ("radcore"."expenses"."stated_total" >= 0 and "radcore"."expenses"."stated_total" <> 'NaN'),
	CONSTRAINT "ck_expenses_total" CHECK ("radcore"."expenses"."total" >= 0 and "radcore"."expenses"."total" <> 'NaN'),
	CONSTRAINT "ck_expenses_notes" CHECK (char_length("radcore"."expenses"."notes") <= 500),
	CONSTRAINT "ck_expenses_cancel_reason" CHECK (char_length("radcore"."expenses"."cancel_reason") <= 500),
	CONSTRAINT "ck_expenses_status" CHECK ("radcore"."expenses"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_expenses_posted" CHECK (("radcore"."expenses"."status" = 'draft') = ("radcore"."expenses"."number" is null) and ("radcore"."expenses"."status" = 'draft') = ("radcore"."expenses"."posted_entry_id" is null)),
	CONSTRAINT "ck_expenses_cancelled" CHECK (("radcore"."expenses"."status" = 'cancelled') = ("radcore"."expenses"."cancel_entry_id" is not null)),
	CONSTRAINT "ck_expenses_owed" CHECK (("radcore"."expenses"."pay_from_account_id" is null and "radcore"."expenses"."party_id" is not null and "radcore"."expenses"."total" = "radcore"."expenses"."stated_total")
    or ("radcore"."expenses"."pay_from_account_id" is not null and "radcore"."expenses"."total" = 0)),
	CONSTRAINT "ck_expenses_supplier_date" CHECK ("radcore"."expenses"."supplier_invoice_date" <= "radcore"."expenses"."business_date"),
	CONSTRAINT "ck_expenses_supplier_gstin" CHECK ("radcore"."expenses"."supplier_gstin" is null or "radcore"."expenses"."supplier_gstin" ~ '^[0-9]{2}[A-Z0-9]{13}$'),
	CONSTRAINT "ck_expenses_supplier_number" CHECK (btrim("radcore"."expenses"."supplier_invoice_number") <> '')
);
--> statement-breakpoint
ALTER TABLE "radcore"."files" DROP CONSTRAINT "ck_files_kind";--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "expense_lines_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "radcore"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "fk_expense_lines_category_account" FOREIGN KEY ("category_id","account_id") REFERENCES "radcore"."expense_category_accounts"("category_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "expenses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "expenses_pay_from_account_id_accounts_id_fk" FOREIGN KEY ("pay_from_account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "expenses_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "expenses_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "expenses_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_expense_lines_line" ON "radcore"."expense_lines" USING btree ("expense_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_expense_lines_category_account" ON "radcore"."expense_lines" USING btree ("category_id","account_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_party" ON "radcore"."expenses" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_pay_from" ON "radcore"."expenses" USING btree ("pay_from_account_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_file" ON "radcore"."expenses" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_posted_entry" ON "radcore"."expenses" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_cancel_entry" ON "radcore"."expenses" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE INDEX "ix_expenses_page" ON "radcore"."expenses" USING btree ("business_date","created_at","id");--> statement-breakpoint
ALTER TABLE "radcore"."files" ADD CONSTRAINT "ck_files_kind" CHECK ("radcore"."files"."kind" in ('photo', 'resume', 'statement', 'import', 'item_picture', 'delivery_photo', 'delivery_note', 'purchase_bill', 'expense_bill'));--> statement-breakpoint
-- RAD-152 (M5-02; ADR-009 §3, §9): expenses are posted documents (ADR-005 §7b): draft -> posted -> cancelled, cancelled
-- final. A draft changes freely; posting sets its number and entry, and its lines' credit before it leaves draft; after
-- that only the move to cancelled and its cancel columns. lib-common's STATE_TRANSITIONS.expenses.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('expenses', 'draft', 'posted'), ('expenses', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.expenses
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.expense_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('expenses', 'expense_id', 'draft');
--> statement-breakpoint
-- One on credit is a payable charge payments apply to (ADR-005 §7a): cancelled only once nothing is applied to it.
CREATE TRIGGER guard_applied_cancel BEFORE UPDATE OF status ON radcore.expenses
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_applied_cancel();
--> statement-breakpoint
INSERT INTO radcore.allocatable_documents (document_table, side, kind) VALUES ('expenses', 'payable', 'charge');
--> statement-breakpoint
-- A posted expense keeps its number: only a draft is deleted (lib-accounts refuses the rest).
REVOKE TRUNCATE ON radcore.expenses, radcore.expense_lines FROM radcore_app;
--> statement-breakpoint
-- Audited like every table (ADR-005 §5); none of these columns is personal data. The lines are the expense's parts.
SELECT radcore.audit_attach('expenses', keep => array['number', 'business_date', 'party_id', 'supplier_invoice_number', 'supplier_invoice_date',
  'supplier_gstin', 'pay_from_account_id', 'status', 'stated_total', 'total', 'file_id', 'notes', 'posted_entry_id', 'cancelled_at',
  'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('expense_lines', keep => array['expense_id', 'line_no', 'category_id', 'account_id', 'description', 'taxable',
  'gst_rate', 'cgst', 'sgst', 'igst', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason'], owner => 'expense_id', owner_table => 'expenses');
--> statement-breakpoint
-- The expenses keys (ADR-009 §9): expenses:read sees them, by maker where scoped; expenses:write enters, posts and cancels
-- them, with the second factor, since it pays. Each joins the role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'expenses:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'expenses:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'expenses:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'expenses:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
