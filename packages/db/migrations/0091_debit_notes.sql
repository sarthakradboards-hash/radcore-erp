CREATE TABLE "radcore"."supplier_return_debits" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"return_line_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"bill_line_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"gst_rate" numeric(9, 6),
	"taxable" numeric(18, 2) NOT NULL,
	"cgst" numeric(18, 2) NOT NULL,
	"sgst" numeric(18, 2) NOT NULL,
	"igst" numeric(18, 2) NOT NULL,
	CONSTRAINT "ck_supplier_return_debits_qty" CHECK ("radcore"."supplier_return_debits"."qty" > 0 and "radcore"."supplier_return_debits"."qty" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_rate" CHECK ("radcore"."supplier_return_debits"."rate" >= 0 and "radcore"."supplier_return_debits"."rate" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_gst_rate" CHECK ("radcore"."supplier_return_debits"."gst_rate" between 0 and 100 and "radcore"."supplier_return_debits"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_taxable" CHECK ("radcore"."supplier_return_debits"."taxable" >= 0 and "radcore"."supplier_return_debits"."taxable" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_cgst" CHECK ("radcore"."supplier_return_debits"."cgst" >= 0 and "radcore"."supplier_return_debits"."cgst" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_sgst" CHECK ("radcore"."supplier_return_debits"."sgst" >= 0 and "radcore"."supplier_return_debits"."sgst" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_debits_igst" CHECK ("radcore"."supplier_return_debits"."igst" >= 0 and "radcore"."supplier_return_debits"."igst" <> 'NaN')
);
--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "debit_note_number" text;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "taxable" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "round_off" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD COLUMN "total" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_debits" ADD CONSTRAINT "supplier_return_debits_return_id_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "radcore"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_debits" ADD CONSTRAINT "supplier_return_debits_return_line_id_supplier_return_lines_id_fk" FOREIGN KEY ("return_line_id") REFERENCES "radcore"."supplier_return_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_debits" ADD CONSTRAINT "supplier_return_debits_bill_id_purchase_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "radcore"."purchase_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_debits" ADD CONSTRAINT "supplier_return_debits_bill_line_id_purchase_bill_lines_id_fk" FOREIGN KEY ("bill_line_id") REFERENCES "radcore"."purchase_bill_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_return_debits_line" ON "radcore"."supplier_return_debits" USING btree ("return_line_id","bill_line_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_debits_return" ON "radcore"."supplier_return_debits" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_debits_bill" ON "radcore"."supplier_return_debits" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_debits_bill_line" ON "radcore"."supplier_return_debits" USING btree ("bill_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_returns_debit_note_number" ON "radcore"."supplier_returns" USING btree ("debit_note_number");--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_taxable" CHECK ("radcore"."supplier_returns"."taxable" >= 0 and "radcore"."supplier_returns"."taxable" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_cgst" CHECK ("radcore"."supplier_returns"."cgst" >= 0 and "radcore"."supplier_returns"."cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_sgst" CHECK ("radcore"."supplier_returns"."sgst" >= 0 and "radcore"."supplier_returns"."sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_igst" CHECK ("radcore"."supplier_returns"."igst" >= 0 and "radcore"."supplier_returns"."igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_round_off" CHECK ("radcore"."supplier_returns"."round_off" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_total" CHECK ("radcore"."supplier_returns"."total" >= 0 and "radcore"."supplier_returns"."total" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "ck_supplier_returns_debit" CHECK (num_nulls("radcore"."supplier_returns"."taxable", "radcore"."supplier_returns"."cgst", "radcore"."supplier_returns"."sgst", "radcore"."supplier_returns"."igst", "radcore"."supplier_returns"."round_off", "radcore"."supplier_returns"."total") in (0, 6)
    and ("radcore"."supplier_returns"."status" <> 'draft' or "radcore"."supplier_returns"."total" is null) and ("radcore"."supplier_returns"."debit_note_number" is null or "radcore"."supplier_returns"."total" is not null)
    and ("radcore"."supplier_returns"."total" is null or ("radcore"."supplier_returns"."total" = "radcore"."supplier_returns"."taxable" + "radcore"."supplier_returns"."cgst" + "radcore"."supplier_returns"."sgst" + "radcore"."supplier_returns"."igst" + "radcore"."supplier_returns"."round_off" and abs("radcore"."supplier_returns"."round_off") < 1)));--> statement-breakpoint
-- RAD-140 PR 2 (ADR-008 §8): a return's billed part, its debit note. Its debits are its parts, written as it posts.
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.supplier_return_debits
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('supplier_returns', 'return_id', 'draft');
--> statement-breakpoint
SELECT radcore.audit_attach('supplier_returns', keep => array['status', 'number', 'party_id', 'business_date', 'location_id', 'reason',
  'notes', 'unbilled_value', 'debit_note_number', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total',
  'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('supplier_return_debits', keep => array['return_id', 'return_line_id', 'bill_id', 'bill_line_id', 'qty', 'rate',
  'gst_rate', 'taxable', 'cgst', 'sgst', 'igst'], owner => 'return_id', owner_table => 'supplier_returns');
--> statement-breakpoint
REVOKE TRUNCATE ON radcore.supplier_return_debits FROM radcore_app;
--> statement-breakpoint
-- A return is a payable credit (ADR-005 §7a): its debit note applies to the bills it debits. Cancelled only once nothing it
-- credits stays applied (its service reverses its applications first; a supplier's refund of it must be reversed by hand).
CREATE TRIGGER guard_applied_cancel BEFORE UPDATE OF status ON radcore.supplier_returns
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_applied_cancel();
--> statement-breakpoint
INSERT INTO radcore.allocatable_documents (document_table, side, kind) VALUES ('supplier_returns', 'payable', 'credit');
