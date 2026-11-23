ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "receipt_line_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "radcore"."goods_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_receipt_line" ON "radcore"."purchase_bill_lines" USING btree ("receipt_line_id");--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_receipt" CHECK ("radcore"."purchase_bill_lines"."receipt_line_id" is null or "radcore"."purchase_bill_lines"."kind" = 'goods');--> statement-breakpoint
-- RAD-138 PR 3 (M4-03; ADR-008 §7): a goods line names the receipt line it bills, once the goods are in. Kept in the
-- audit trail with the rest of the line (attached again, as 0087 left it plus the new column).
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id', 'item_id', 'qty',
  'rate', 'charge', 'description', 'hsn', 'amount', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'],
  owner => 'bill_id', owner_table => 'purchase_bills');
--> statement-breakpoint
-- A posted bill is a payable charge payments and debit notes are applied to (ADR-005 §7a, ADR-008 §7): cancelled only
-- once nothing is applied to it, then registered.
CREATE TRIGGER guard_applied_cancel BEFORE UPDATE OF status ON radcore.purchase_bills
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_applied_cancel();
--> statement-breakpoint
INSERT INTO radcore.allocatable_documents (document_table, side, kind) VALUES ('purchase_bills', 'payable', 'charge');
