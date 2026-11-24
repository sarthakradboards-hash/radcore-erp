ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "grni_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_grni_value" CHECK ("radcore"."purchase_bill_lines"."grni_value" >= 0 and "radcore"."purchase_bill_lines"."grni_value" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_grni" CHECK ("radcore"."purchase_bill_lines"."grni_value" is null or "radcore"."purchase_bill_lines"."receipt_line_id" is not null);
--> statement-breakpoint
-- RAD-95 (ADR-006 §7, the architect's ruling on RAD-95): what a bill line cleared of its receipt line's Goods Received
-- Not Billed, set at posting, for the books check. Kept in the audit trail with the rest of the line, as 0090 left it (0091 left it alone).
-- Bills posted before this migration have no grni_value, so on such a database the check reads their lines as never
-- cleared (grni_line). There is no production data yet (the auditor on #398), so nothing is backfilled.
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id', 'item_id', 'qty',
  'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst',
  'line_total'], owner => 'bill_id', owner_table => 'purchase_bills');
