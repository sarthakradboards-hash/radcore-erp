ALTER TABLE "radcore"."purchase_bill_lines" DROP CONSTRAINT "ck_purchase_bill_lines_kind";--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "job_work_receipt_line_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "jwcb_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_job_work_receipt_line_id_job_work_receipt_lines_id_fk" FOREIGN KEY ("job_work_receipt_line_id") REFERENCES "radcore"."job_work_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_job_work_line" ON "radcore"."purchase_bill_lines" USING btree ("job_work_receipt_line_id");--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_jwcb_value" CHECK ("radcore"."purchase_bill_lines"."jwcb_value" >= 0 and "radcore"."purchase_bill_lines"."jwcb_value" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_job_work" CHECK (("radcore"."purchase_bill_lines"."kind" = 'job_work') = ("radcore"."purchase_bill_lines"."job_work_receipt_line_id" is not null and "radcore"."purchase_bill_lines"."item_id" is not null
    and "radcore"."purchase_bill_lines"."qty" is not null and "radcore"."purchase_bill_lines"."rate" is not null and "radcore"."purchase_bill_lines"."hsn" is not null));--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_one_source" CHECK (num_nonnulls("radcore"."purchase_bill_lines"."receipt_line_id", "radcore"."purchase_bill_lines"."job_work_receipt_line_id") <= 1);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_jwcb" CHECK ("radcore"."purchase_bill_lines"."jwcb_value" is null or "radcore"."purchase_bill_lines"."job_work_receipt_line_id" is not null);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_kind" CHECK ("radcore"."purchase_bill_lines"."kind" in ('goods', 'charge', 'job_work'));
--> statement-breakpoint
-- RAD-142 (ADR-008 §7, §11; the architect's sketch on RAD-142): a job worker's bill names a job-work receipt line's
-- charge, as a goods line names a goods receipt line. Kept in the audit trail with the rest of the line.
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id',
  'job_work_receipt_line_id', 'item_id', 'qty', 'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'jwcb_value',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'], owner => 'bill_id', owner_table => 'purchase_bills');
--> statement-breakpoint
-- A job-work receipt is undone only while no bill that isn't cancelled names one of its lines' charges (ADR-008 §11):
-- lib-stock can't read purchasing's bills, so the database holds it, as guard_applied_cancel does for allocations.
-- The cancel holds the receipt FOR UPDATE, and a bill's posting holds it too (§12), so the two never cross.
CREATE FUNCTION radcore.guard_job_work_charges_billed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND EXISTS (
    SELECT 1 FROM radcore.purchase_bill_lines bl
      JOIN radcore.purchase_bills b ON b.id = bl.bill_id
      JOIN radcore.job_work_receipt_lines rl ON rl.id = bl.job_work_receipt_line_id
     WHERE rl.receipt_id = NEW.id AND b.status <> 'cancelled') THEN
    RAISE EXCEPTION 'job_work_receipts % has its charges on a purchase bill: cancel the bill first', NEW.id
      USING ERRCODE = 'RA006', CONSTRAINT = 'job_work_charges_billed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.guard_job_work_charges_billed() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_job_work_charges_billed BEFORE UPDATE OF status ON radcore.job_work_receipts
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_job_work_charges_billed();
