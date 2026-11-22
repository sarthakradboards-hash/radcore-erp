ALTER TABLE "radcore"."invoice_lines" ADD COLUMN "unit_condition" text;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "ck_invoice_lines_unit_condition" CHECK ("radcore"."invoice_lines"."unit_condition" is null or "radcore"."invoice_lines"."unit_condition" in ('demo', 'used', 'damaged'));
--> statement-breakpoint
-- Part of RAD-112 (the architect, with stock.sell_damaged_units): an invoice line carries the worst condition of the
-- units it bills when they aren't all new, copied at posting so the buyer is told. Kept in the audit trail with the
-- rest of the line (attached again, as 0059 left it plus the new column).
SELECT radcore.audit_attach('invoice_lines', keep => array['invoice_id', 'line_no', 'delivery_line_id', 'item_id', 'qty', 'rate',
  'discount_percent', 'list_rate', 'list_version_id', 'hsn', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'cess_ad_valorem', 'cess_per_unit_amount',
  'line_total', 'cost', 'delivery_taxable', 'delivery_gst', 'unit_condition'], owner => 'invoice_id', owner_table => 'invoices');
