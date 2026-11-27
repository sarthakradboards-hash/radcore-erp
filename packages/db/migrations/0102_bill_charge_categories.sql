ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "expense_category_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "expense_account_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "fk_purchase_bill_lines_expense_category" FOREIGN KEY ("expense_category_id","expense_account_id") REFERENCES "radcore"."expense_category_accounts"("category_id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_expense_category" ON "radcore"."purchase_bill_lines" USING btree ("expense_category_id","expense_account_id");--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_expense_category" CHECK (num_nulls("radcore"."purchase_bill_lines"."expense_category_id", "radcore"."purchase_bill_lines"."expense_account_id") in (0, 2)
    and ("radcore"."purchase_bill_lines"."expense_category_id" is null or "radcore"."purchase_bill_lines"."kind" = 'charge'));--> statement-breakpoint
-- RAD-152 (ADR-009 §2): a charge line's expense category and account, for its blocked credit and, on a bill of charges
-- only, where it posts. Kept in the audit trail with the rest of the line.
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id',
  'job_work_receipt_line_id', 'item_id', 'qty', 'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'jwcb_value',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason',
  'expense_category_id', 'expense_account_id'], owner => 'bill_id', owner_table => 'purchase_bills');
