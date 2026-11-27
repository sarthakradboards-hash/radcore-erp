CREATE TABLE "radcore"."party_tds" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"party_id" uuid PRIMARY KEY NOT NULL,
	"default_section_id" uuid,
	"pan_inoperative" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radcore"."tds_deductions" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_line_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"financial_year" date NOT NULL,
	"business_date" date NOT NULL,
	"base" numeric(18, 2) NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"no_pan_rate" boolean NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reverses_id" uuid,
	CONSTRAINT "ck_tds_deductions_base" CHECK ("radcore"."tds_deductions"."base" <> 'NaN'),
	CONSTRAINT "ck_tds_deductions_rate" CHECK ("radcore"."tds_deductions"."rate" between 0 and 100 and "radcore"."tds_deductions"."rate" <> 'NaN'),
	CONSTRAINT "ck_tds_deductions_amount" CHECK ("radcore"."tds_deductions"."amount" <> 'NaN'),
	CONSTRAINT "ck_tds_deductions_source_table" CHECK ("radcore"."tds_deductions"."source_table" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_tds_deductions_year" CHECK (extract(month from "radcore"."tds_deductions"."financial_year") = 4 and extract(day from "radcore"."tds_deductions"."financial_year") = 1),
	CONSTRAINT "ck_tds_deductions_sign" CHECK (("radcore"."tds_deductions"."reverses_id" is null) = ("radcore"."tds_deductions"."base" >= 0 and "radcore"."tds_deductions"."amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "tds_section_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."expense_categories" ADD COLUMN "default_tds_section_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD COLUMN "tds_section_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."party_tds" ADD CONSTRAINT "party_tds_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."party_tds" ADD CONSTRAINT "party_tds_default_section_id_tds_sections_id_fk" FOREIGN KEY ("default_section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deductions" ADD CONSTRAINT "tds_deductions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deductions" ADD CONSTRAINT "tds_deductions_section_id_tds_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deductions" ADD CONSTRAINT "tds_deductions_reverses_id_tds_deductions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "radcore"."tds_deductions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_party_tds_section" ON "radcore"."party_tds" USING btree ("default_section_id");--> statement-breakpoint
CREATE INDEX "ix_tds_deductions_year" ON "radcore"."tds_deductions" USING btree ("party_id","section_id","financial_year");--> statement-breakpoint
CREATE INDEX "ix_tds_deductions_source" ON "radcore"."tds_deductions" USING btree ("source_table","source_id");--> statement-breakpoint
CREATE INDEX "ix_tds_deductions_section" ON "radcore"."tds_deductions" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tds_deductions_reverses" ON "radcore"."tds_deductions" USING btree ("reverses_id");--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_tds_section_id_tds_sections_id_fk" FOREIGN KEY ("tds_section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expense_categories" ADD CONSTRAINT "expense_categories_default_tds_section_id_tds_sections_id_fk" FOREIGN KEY ("default_tds_section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "expense_lines_tds_section_id_tds_sections_id_fk" FOREIGN KEY ("tds_section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_tds_section" ON "radcore"."purchase_bill_lines" USING btree ("tds_section_id");--> statement-breakpoint
CREATE INDEX "ix_expense_categories_tds_section" ON "radcore"."expense_categories" USING btree ("default_tds_section_id");--> statement-breakpoint
CREATE INDEX "ix_expense_lines_tds_section" ON "radcore"."expense_lines" USING btree ("tds_section_id");--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_tds_section" CHECK ("radcore"."purchase_bill_lines"."tds_section_id" is null or "radcore"."purchase_bill_lines"."kind" in ('charge', 'job_work'));--> statement-breakpoint
-- RAD-158 PR 2b (ADR-009 §4): TDS at booking. Each line with a section writes its deduction row with the posting; a
-- cancel writes the reversal. Append-only, like the allocations ledger: a mistake is undone by its reversal, never an edit.
SELECT radcore.audit_attach('tds_deductions', keep => array['source_table', 'source_id', 'source_line_id', 'party_id', 'section_id',
  'financial_year', 'business_date', 'base', 'rate', 'no_pan_rate', 'amount', 'reverses_id']);
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.tds_deductions FROM radcore_app;
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.tds_deductions FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
SELECT radcore.audit_attach('party_tds', keep => array['party_id', 'default_section_id', 'pan_inoperative']);
--> statement-breakpoint
SELECT radcore.audit_attach('expense_categories', keep => array['name', 'name_key', 'credit', 'blocked_clause', 'active', 'default_tds_section_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('expense_lines', keep => array['expense_id', 'line_no', 'category_id', 'account_id', 'description', 'taxable',
  'gst_rate', 'cgst', 'sgst', 'igst', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason', 'tds_section_id'], owner => 'expense_id',
  owner_table => 'expenses');
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id',
  'job_work_receipt_line_id', 'item_id', 'qty', 'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'jwcb_value',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason',
  'expense_category_id', 'expense_account_id', 'rcm_cgst', 'rcm_sgst', 'rcm_igst', 'tds_section_id'], owner => 'bill_id', owner_table => 'purchase_bills');
