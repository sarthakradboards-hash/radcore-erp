ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "credit_cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "credit_sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "credit_igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "credit_reason" text;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit_cgst" CHECK ("radcore"."purchase_bill_lines"."credit_cgst" >= 0 and "radcore"."purchase_bill_lines"."credit_cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit_sgst" CHECK ("radcore"."purchase_bill_lines"."credit_sgst" >= 0 and "radcore"."purchase_bill_lines"."credit_sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit_igst" CHECK ("radcore"."purchase_bill_lines"."credit_igst" >= 0 and "radcore"."purchase_bill_lines"."credit_igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit" CHECK (num_nulls("radcore"."purchase_bill_lines"."credit_cgst", "radcore"."purchase_bill_lines"."credit_sgst", "radcore"."purchase_bill_lines"."credit_igst") in (0, 3)
    and ("radcore"."purchase_bill_lines"."credit_cgst" is null or "radcore"."purchase_bill_lines"."gst_rate" is not null) and ("radcore"."purchase_bill_lines"."credit_reason" is null or "radcore"."purchase_bill_lines"."credit_cgst" is not null));--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit_whole" CHECK ("radcore"."purchase_bill_lines"."credit_cgst" is null
    or ("radcore"."purchase_bill_lines"."credit_reason" is null and "radcore"."purchase_bill_lines"."credit_cgst" = "radcore"."purchase_bill_lines"."cgst" and "radcore"."purchase_bill_lines"."credit_sgst" = "radcore"."purchase_bill_lines"."sgst" and "radcore"."purchase_bill_lines"."credit_igst" = "radcore"."purchase_bill_lines"."igst")
    or ("radcore"."purchase_bill_lines"."credit_reason" in ('supplier_kind', 'blocked', 'state') and "radcore"."purchase_bill_lines"."credit_cgst" = 0 and "radcore"."purchase_bill_lines"."credit_sgst" = 0 and "radcore"."purchase_bill_lines"."credit_igst" = 0));--> statement-breakpoint
-- RAD-139 (ADR-009 §2): the input credit a bill line claimed at posting, by head, and where none, why (supplier_kind,
-- blocked, state), for ADR-010's 3B. Bills posted before this keep what they posted and have none (no production data
-- yet, as 0092 noted). Kept in the audit trail with the rest of the line.
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id',
  'job_work_receipt_line_id', 'item_id', 'qty', 'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'jwcb_value',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason'],
  owner => 'bill_id', owner_table => 'purchase_bills');
