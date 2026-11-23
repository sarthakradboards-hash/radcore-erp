CREATE TABLE "radcore"."purchase_bill_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text NOT NULL,
	"po_line_id" uuid,
	"item_id" uuid,
	"qty" numeric(18, 3),
	"rate" numeric(18, 6),
	"charge" text,
	"description" text,
	"hsn" text,
	"amount" numeric(18, 2),
	"gst_rate" numeric(9, 6),
	"gst_rate_source" text,
	"taxable" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"line_total" numeric(18, 2),
	CONSTRAINT "ck_purchase_bill_lines_qty" CHECK ("radcore"."purchase_bill_lines"."qty" > 0 and "radcore"."purchase_bill_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_rate" CHECK ("radcore"."purchase_bill_lines"."rate" >= 0 and "radcore"."purchase_bill_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_description" CHECK (char_length("radcore"."purchase_bill_lines"."description") <= 100),
	CONSTRAINT "ck_purchase_bill_lines_amount" CHECK ("radcore"."purchase_bill_lines"."amount" >= 0 and "radcore"."purchase_bill_lines"."amount" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_gst_rate" CHECK ("radcore"."purchase_bill_lines"."gst_rate" between 0 and 100 and "radcore"."purchase_bill_lines"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_gst_rate_source" CHECK (char_length("radcore"."purchase_bill_lines"."gst_rate_source") <= 200),
	CONSTRAINT "ck_purchase_bill_lines_taxable" CHECK ("radcore"."purchase_bill_lines"."taxable" >= 0 and "radcore"."purchase_bill_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_cgst" CHECK ("radcore"."purchase_bill_lines"."cgst" >= 0 and "radcore"."purchase_bill_lines"."cgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_sgst" CHECK ("radcore"."purchase_bill_lines"."sgst" >= 0 and "radcore"."purchase_bill_lines"."sgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_igst" CHECK ("radcore"."purchase_bill_lines"."igst" >= 0 and "radcore"."purchase_bill_lines"."igst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_line_total" CHECK ("radcore"."purchase_bill_lines"."line_total" >= 0 and "radcore"."purchase_bill_lines"."line_total" <> 'NaN'),
	CONSTRAINT "ck_purchase_bill_lines_kind" CHECK ("radcore"."purchase_bill_lines"."kind" in ('goods', 'charge')),
	CONSTRAINT "ck_purchase_bill_lines_goods" CHECK (("radcore"."purchase_bill_lines"."kind" = 'goods') = ("radcore"."purchase_bill_lines"."po_line_id" is not null and "radcore"."purchase_bill_lines"."item_id" is not null and "radcore"."purchase_bill_lines"."qty" is not null
    and "radcore"."purchase_bill_lines"."rate" is not null) and ("radcore"."purchase_bill_lines"."kind" = 'charge') = ("radcore"."purchase_bill_lines"."charge" is not null and "radcore"."purchase_bill_lines"."description" is not null and "radcore"."purchase_bill_lines"."hsn" is not null
    and "radcore"."purchase_bill_lines"."amount" is not null)),
	CONSTRAINT "ck_purchase_bill_lines_charge" CHECK ("radcore"."purchase_bill_lines"."charge" is null or "radcore"."purchase_bill_lines"."charge" in ('freight', 'packing', 'insurance', 'other')),
	CONSTRAINT "ck_purchase_bill_lines_hsn" CHECK ("radcore"."purchase_bill_lines"."hsn" is null or "radcore"."purchase_bill_lines"."hsn" ~ '^[0-9]{4}([0-9]{2}){0,2}$'),
	CONSTRAINT "ck_purchase_bill_lines_frozen" CHECK (num_nulls("radcore"."purchase_bill_lines"."gst_rate", "radcore"."purchase_bill_lines"."gst_rate_source", "radcore"."purchase_bill_lines"."taxable", "radcore"."purchase_bill_lines"."cgst", "radcore"."purchase_bill_lines"."sgst", "radcore"."purchase_bill_lines"."igst",
    "radcore"."purchase_bill_lines"."line_total") in (0, 7)),
	CONSTRAINT "ck_purchase_bill_lines_identity" CHECK ("radcore"."purchase_bill_lines"."line_total" = "radcore"."purchase_bill_lines"."taxable" + "radcore"."purchase_bill_lines"."cgst" + "radcore"."purchase_bill_lines"."sgst" + "radcore"."purchase_bill_lines"."igst"
    and "radcore"."purchase_bill_lines"."cgst" = "radcore"."purchase_bill_lines"."sgst" and ("radcore"."purchase_bill_lines"."igst" = 0 or "radcore"."purchase_bill_lines"."cgst" = 0))
);
--> statement-breakpoint
CREATE TABLE "radcore"."purchase_bills" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"supplier_invoice_key" text GENERATED ALWAYS AS (upper(btrim(supplier_invoice_number))) STORED NOT NULL,
	"supplier_invoice_date" date NOT NULL,
	"supplier_invoice_fy" date GENERATED ALWAYS AS (make_date(extract(year from supplier_invoice_date)::int - (extract(month from supplier_invoice_date) < 4)::int, 4, 1)) STORED NOT NULL,
	"supplier_gstin" text,
	"stated_total" numeric(18, 2) NOT NULL,
	"file_id" uuid,
	"notes" text,
	"place_of_supply" text,
	"taxable" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"round_off" numeric(18, 2),
	"total" numeric(18, 2),
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "purchase_bills_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_purchase_bills_supplier_invoice_number" CHECK (char_length("radcore"."purchase_bills"."supplier_invoice_number") <= 40),
	CONSTRAINT "ck_purchase_bills_stated_total" CHECK ("radcore"."purchase_bills"."stated_total" >= 0 and "radcore"."purchase_bills"."stated_total" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_notes" CHECK (char_length("radcore"."purchase_bills"."notes") <= 500),
	CONSTRAINT "ck_purchase_bills_taxable" CHECK ("radcore"."purchase_bills"."taxable" >= 0 and "radcore"."purchase_bills"."taxable" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_cgst" CHECK ("radcore"."purchase_bills"."cgst" >= 0 and "radcore"."purchase_bills"."cgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_sgst" CHECK ("radcore"."purchase_bills"."sgst" >= 0 and "radcore"."purchase_bills"."sgst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_igst" CHECK ("radcore"."purchase_bills"."igst" >= 0 and "radcore"."purchase_bills"."igst" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_round_off" CHECK ("radcore"."purchase_bills"."round_off" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_total" CHECK ("radcore"."purchase_bills"."total" >= 0 and "radcore"."purchase_bills"."total" <> 'NaN'),
	CONSTRAINT "ck_purchase_bills_cancel_reason" CHECK (char_length("radcore"."purchase_bills"."cancel_reason") <= 500),
	CONSTRAINT "ck_purchase_bills_status" CHECK ("radcore"."purchase_bills"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_purchase_bills_posted" CHECK (("radcore"."purchase_bills"."status" = 'draft') = ("radcore"."purchase_bills"."number" is null) and ("radcore"."purchase_bills"."status" = 'draft') = ("radcore"."purchase_bills"."total" is null)),
	CONSTRAINT "ck_purchase_bills_cancelled" CHECK (("radcore"."purchase_bills"."status" = 'cancelled') = ("radcore"."purchase_bills"."cancel_entry_id" is not null)),
	CONSTRAINT "ck_purchase_bills_frozen" CHECK (num_nulls("radcore"."purchase_bills"."place_of_supply", "radcore"."purchase_bills"."taxable", "radcore"."purchase_bills"."cgst", "radcore"."purchase_bills"."sgst", "radcore"."purchase_bills"."igst", "radcore"."purchase_bills"."round_off", "radcore"."purchase_bills"."total") in (0, 7)
    and coalesce("radcore"."purchase_bills"."place_of_supply", '00') ~ '^[0-9]{2}$'),
	CONSTRAINT "ck_purchase_bills_identity" CHECK ("radcore"."purchase_bills"."total" = "radcore"."purchase_bills"."taxable" + "radcore"."purchase_bills"."cgst" + "radcore"."purchase_bills"."sgst" + "radcore"."purchase_bills"."igst" + "radcore"."purchase_bills"."round_off"
    and abs("radcore"."purchase_bills"."round_off") < 1 and "radcore"."purchase_bills"."cgst" = "radcore"."purchase_bills"."sgst" and ("radcore"."purchase_bills"."igst" = 0 or "radcore"."purchase_bills"."cgst" = 0)),
	CONSTRAINT "ck_purchase_bills_supplier_date" CHECK ("radcore"."purchase_bills"."supplier_invoice_date" <= "radcore"."purchase_bills"."business_date"),
	CONSTRAINT "ck_purchase_bills_supplier_gstin" CHECK ("radcore"."purchase_bills"."supplier_gstin" is null or "radcore"."purchase_bills"."supplier_gstin" ~ '^[0-9]{2}[A-Z0-9]{13}$'),
	CONSTRAINT "ck_purchase_bills_supplier_number" CHECK (btrim("radcore"."purchase_bills"."supplier_invoice_number") <> '')
);
--> statement-breakpoint
ALTER TABLE "radcore"."files" DROP CONSTRAINT "ck_files_kind";--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_bill_id_purchase_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "radcore"."purchase_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "radcore"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "purchase_bills_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "purchase_bills_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "purchase_bills_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "purchase_bills_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_purchase_bill_lines_line" ON "radcore"."purchase_bill_lines" USING btree ("bill_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_po_line" ON "radcore"."purchase_bill_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_bill_lines_item" ON "radcore"."purchase_bill_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_purchase_bills_supplier_invoice" ON "radcore"."purchase_bills" USING btree ("party_id","supplier_invoice_fy","supplier_invoice_key") WHERE "radcore"."purchase_bills"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "ix_purchase_bills_party" ON "radcore"."purchase_bills" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_bills_date" ON "radcore"."purchase_bills" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_purchase_bills_file" ON "radcore"."purchase_bills" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_bills_posted_entry" ON "radcore"."purchase_bills" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_bills_cancel_entry" ON "radcore"."purchase_bills" USING btree ("cancel_entry_id");--> statement-breakpoint
ALTER TABLE "radcore"."files" ADD CONSTRAINT "ck_files_kind" CHECK ("radcore"."files"."kind" in ('photo', 'resume', 'statement', 'import', 'item_picture', 'delivery_photo', 'delivery_note', 'purchase_bill'));--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c); none of these columns is personal data. A bill's lines are its parts
-- (ADR-001 §8b): their audit rows carry the bill's id, so maker-checker finds everyone who changed a bill since its
-- approval was asked for (RC-037).
SELECT radcore.audit_attach('purchase_bills', keep => array['number', 'party_id', 'business_date', 'status', 'supplier_invoice_number',
  'supplier_invoice_key', 'supplier_invoice_date', 'supplier_invoice_fy', 'supplier_gstin', 'stated_total', 'file_id', 'notes', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst',
  'round_off', 'total', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'item_id', 'qty', 'rate',
  'charge', 'description', 'hsn', 'amount', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total'],
  owner => 'bill_id', owner_table => 'purchase_bills');
--> statement-breakpoint
-- A posted bill keeps its number: only a draft is deleted (lib-purchasing refuses the rest).
REVOKE TRUNCATE ON radcore.purchase_bills, radcore.purchase_bill_lines FROM radcore_app;
--> statement-breakpoint
-- RAD-138 (M4-03; ADR-008 §1, §2): purchase bills are posted documents (ADR-005 §7b): draft -> posted -> cancelled,
-- cancelled final. While a draft, anything changes; its posting sets its number, entry and figures; after that only the
-- move to cancelled and its cancel columns, and the lines not at all. lib-common's STATE_TRANSITIONS.purchase_bills.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('purchase_bills', 'draft', 'posted'), ('purchase_bills', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.purchase_bills
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.purchase_bill_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('purchase_bills', 'bill_id', 'draft');
--> statement-breakpoint
-- The bills keys (ADR-008 §13), ordinary catalogue keys any role can be given, with no second factor: a bill makes a
-- payable and paying it is M3-12's. Accounts enters bills, the owner approves those over the tolerance, and the admin
-- holds every key. Each joins the role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'bills:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
UNION ALL SELECT r, 'bills:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'bills:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
UNION ALL SELECT r, 'bills:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
