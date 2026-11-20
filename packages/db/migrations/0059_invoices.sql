CREATE TABLE "radcore"."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"delivery_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"discount_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"list_rate" numeric(18, 6),
	"list_version_id" uuid,
	"hsn" text,
	"gst_rate" numeric(9, 6),
	"gst_rate_source" text,
	"taxable" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"cess_ad_valorem" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_per_unit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2),
	"cost" numeric(18, 2),
	"delivery_taxable" numeric(18, 2),
	"delivery_gst" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_invoice_lines_qty" CHECK ("radcore"."invoice_lines"."qty" > 0 and "radcore"."invoice_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_rate" CHECK ("radcore"."invoice_lines"."rate" >= 0 and "radcore"."invoice_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_discount_percent" CHECK ("radcore"."invoice_lines"."discount_percent" between 0 and 100 and "radcore"."invoice_lines"."discount_percent" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_list_rate" CHECK ("radcore"."invoice_lines"."list_rate" >= 0 and "radcore"."invoice_lines"."list_rate" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_gst_rate" CHECK ("radcore"."invoice_lines"."gst_rate" between 0 and 100 and "radcore"."invoice_lines"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_gst_rate_source" CHECK (char_length("radcore"."invoice_lines"."gst_rate_source") <= 200),
	CONSTRAINT "ck_invoice_lines_taxable" CHECK ("radcore"."invoice_lines"."taxable" >= 0 and "radcore"."invoice_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_cgst" CHECK ("radcore"."invoice_lines"."cgst" >= 0 and "radcore"."invoice_lines"."cgst" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_sgst" CHECK ("radcore"."invoice_lines"."sgst" >= 0 and "radcore"."invoice_lines"."sgst" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_igst" CHECK ("radcore"."invoice_lines"."igst" >= 0 and "radcore"."invoice_lines"."igst" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_cess_ad_valorem" CHECK ("radcore"."invoice_lines"."cess_ad_valorem" >= 0 and "radcore"."invoice_lines"."cess_ad_valorem" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_cess_per_unit_amount" CHECK ("radcore"."invoice_lines"."cess_per_unit_amount" >= 0 and "radcore"."invoice_lines"."cess_per_unit_amount" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_line_total" CHECK ("radcore"."invoice_lines"."line_total" >= 0 and "radcore"."invoice_lines"."line_total" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_cost" CHECK ("radcore"."invoice_lines"."cost" >= 0 and "radcore"."invoice_lines"."cost" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_delivery_taxable" CHECK ("radcore"."invoice_lines"."delivery_taxable" >= 0 and "radcore"."invoice_lines"."delivery_taxable" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_delivery_gst" CHECK ("radcore"."invoice_lines"."delivery_gst" >= 0 and "radcore"."invoice_lines"."delivery_gst" <> 'NaN'),
	CONSTRAINT "ck_invoice_lines_posted" CHECK (num_nulls("radcore"."invoice_lines"."hsn", "radcore"."invoice_lines"."gst_rate", "radcore"."invoice_lines"."gst_rate_source", "radcore"."invoice_lines"."taxable", "radcore"."invoice_lines"."cgst", "radcore"."invoice_lines"."sgst", "radcore"."invoice_lines"."igst",
    "radcore"."invoice_lines"."line_total", "radcore"."invoice_lines"."cost", "radcore"."invoice_lines"."delivery_taxable", "radcore"."invoice_lines"."delivery_gst") in (0, 11)),
	CONSTRAINT "ck_invoice_lines_identity" CHECK ("radcore"."invoice_lines"."line_total" = "radcore"."invoice_lines"."taxable" + "radcore"."invoice_lines"."cgst" + "radcore"."invoice_lines"."sgst" + "radcore"."invoice_lines"."igst" + "radcore"."invoice_lines"."cess_ad_valorem" + "radcore"."invoice_lines"."cess_per_unit_amount"
    and "radcore"."invoice_lines"."cgst" = "radcore"."invoice_lines"."sgst" and ("radcore"."invoice_lines"."igst" = 0 or "radcore"."invoice_lines"."cgst" = 0))
);
--> statement-breakpoint
CREATE TABLE "radcore"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"price_list_id" uuid,
	"business_date" date NOT NULL,
	"notes" text,
	"owner" text NOT NULL,
	"ship_to_name" text,
	"ship_to_address" text,
	"ship_to_state_code" text,
	"issuer_legal_name" text,
	"issuer_gstin" text,
	"issuer_address_line1" text,
	"issuer_address_line2" text,
	"issuer_city" text,
	"issuer_pincode" text,
	"issuer_state_code" text,
	"buyer_name" text,
	"buyer_gstin" text,
	"buyer_address_line1" text,
	"buyer_address_line2" text,
	"buyer_city" text,
	"buyer_pincode" text,
	"buyer_state_code" text,
	"place_of_supply" text,
	"taxable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess" numeric(18, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"override_version" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_invoices_notes" CHECK (char_length("radcore"."invoices"."notes") <= 500),
	CONSTRAINT "ck_invoices_ship_to_name" CHECK (char_length("radcore"."invoices"."ship_to_name") <= 200),
	CONSTRAINT "ck_invoices_ship_to_address" CHECK (char_length("radcore"."invoices"."ship_to_address") <= 400),
	CONSTRAINT "ck_invoices_issuer_legal_name" CHECK (char_length("radcore"."invoices"."issuer_legal_name") <= 200),
	CONSTRAINT "ck_invoices_issuer_address_line1" CHECK (char_length("radcore"."invoices"."issuer_address_line1") <= 200),
	CONSTRAINT "ck_invoices_issuer_address_line2" CHECK (char_length("radcore"."invoices"."issuer_address_line2") <= 200),
	CONSTRAINT "ck_invoices_issuer_city" CHECK (char_length("radcore"."invoices"."issuer_city") <= 100),
	CONSTRAINT "ck_invoices_buyer_name" CHECK (char_length("radcore"."invoices"."buyer_name") <= 200),
	CONSTRAINT "ck_invoices_buyer_address_line1" CHECK (char_length("radcore"."invoices"."buyer_address_line1") <= 200),
	CONSTRAINT "ck_invoices_buyer_address_line2" CHECK (char_length("radcore"."invoices"."buyer_address_line2") <= 200),
	CONSTRAINT "ck_invoices_buyer_city" CHECK (char_length("radcore"."invoices"."buyer_city") <= 100),
	CONSTRAINT "ck_invoices_taxable" CHECK ("radcore"."invoices"."taxable" >= 0 and "radcore"."invoices"."taxable" <> 'NaN'),
	CONSTRAINT "ck_invoices_cgst" CHECK ("radcore"."invoices"."cgst" >= 0 and "radcore"."invoices"."cgst" <> 'NaN'),
	CONSTRAINT "ck_invoices_sgst" CHECK ("radcore"."invoices"."sgst" >= 0 and "radcore"."invoices"."sgst" <> 'NaN'),
	CONSTRAINT "ck_invoices_igst" CHECK ("radcore"."invoices"."igst" >= 0 and "radcore"."invoices"."igst" <> 'NaN'),
	CONSTRAINT "ck_invoices_cess" CHECK ("radcore"."invoices"."cess" >= 0 and "radcore"."invoices"."cess" <> 'NaN'),
	CONSTRAINT "ck_invoices_round_off" CHECK ("radcore"."invoices"."round_off" <> 'NaN'),
	CONSTRAINT "ck_invoices_total" CHECK ("radcore"."invoices"."total" >= 0 and "radcore"."invoices"."total" <> 'NaN'),
	CONSTRAINT "ck_invoices_cancel_reason" CHECK (char_length("radcore"."invoices"."cancel_reason") <= 500),
	CONSTRAINT "ck_invoices_status" CHECK ("radcore"."invoices"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_invoices_posted" CHECK (("radcore"."invoices"."status" = 'draft') = ("radcore"."invoices"."number" is null) and ("radcore"."invoices"."status" <> 'draft' or "radcore"."invoices"."posted_entry_id" is null)
    and ("radcore"."invoices"."status" = 'draft') = ("radcore"."invoices"."issuer_gstin" is null) and ("radcore"."invoices"."status" = 'draft') = ("radcore"."invoices"."place_of_supply" is null)),
	CONSTRAINT "ck_invoices_cancelled" CHECK (("radcore"."invoices"."status" = 'cancelled') = ("radcore"."invoices"."cancel_entry_id" is not null)),
	CONSTRAINT "ck_invoices_identity" CHECK ("radcore"."invoices"."total" = "radcore"."invoices"."taxable" + "radcore"."invoices"."cgst" + "radcore"."invoices"."sgst" + "radcore"."invoices"."igst" + "radcore"."invoices"."cess" + "radcore"."invoices"."round_off"
    and abs("radcore"."invoices"."round_off") < 1 and "radcore"."invoices"."cgst" = "radcore"."invoices"."sgst" and ("radcore"."invoices"."igst" = 0 or "radcore"."invoices"."cgst" = 0)),
	CONSTRAINT "ck_invoices_state_codes" CHECK (coalesce("radcore"."invoices"."ship_to_state_code", '00') ~ '^[0-9]{2}$' and coalesce("radcore"."invoices"."issuer_state_code", '00') ~ '^[0-9]{2}$'
    and coalesce("radcore"."invoices"."buyer_state_code", '00') ~ '^[0-9]{2}$' and coalesce("radcore"."invoices"."place_of_supply", '00') ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."party_price_lists" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"price_list_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "list_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD COLUMN "list_version_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "radcore"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "invoice_lines_delivery_line_id_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "radcore"."delivery_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "invoice_lines_list_version_id_price_list_versions_id_fk" FOREIGN KEY ("list_version_id") REFERENCES "radcore"."price_list_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "invoices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "radcore"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "invoices_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "invoices_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."party_price_lists" ADD CONSTRAINT "party_price_lists_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."party_price_lists" ADD CONSTRAINT "party_price_lists_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "radcore"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invoice_lines_line" ON "radcore"."invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_invoice_lines_list_version" ON "radcore"."invoice_lines" USING btree ("list_version_id");--> statement-breakpoint
CREATE INDEX "ix_invoice_lines_delivery_line" ON "radcore"."invoice_lines" USING btree ("delivery_line_id");--> statement-breakpoint
CREATE INDEX "ix_invoice_lines_item" ON "radcore"."invoice_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_party_date" ON "radcore"."invoices" USING btree ("party_id","business_date");--> statement-breakpoint
CREATE INDEX "ix_invoices_posted_entry" ON "radcore"."invoices" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_cancel_entry" ON "radcore"."invoices" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_date" ON "radcore"."invoices" USING btree ("business_date","id");--> statement-breakpoint
CREATE INDEX "ix_invoices_owner" ON "radcore"."invoices" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "ix_invoices_price_list" ON "radcore"."invoices" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "ix_party_price_lists_list" ON "radcore"."party_price_lists" USING btree ("price_list_id");--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_list_version_id_price_list_versions_id_fk" FOREIGN KEY ("list_version_id") REFERENCES "radcore"."price_list_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."sales_orders" ADD CONSTRAINT "sales_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "radcore"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sales_order_lines_list_version" ON "radcore"."sales_order_lines" USING btree ("list_version_id");--> statement-breakpoint
CREATE INDEX "ix_sales_orders_price_list" ON "radcore"."sales_orders" USING btree ("price_list_id");--> statement-breakpoint
ALTER TABLE "radcore"."sales_order_lines" ADD CONSTRAINT "ck_sales_order_lines_list_rate" CHECK ("radcore"."sales_order_lines"."list_rate" >= 0 and "radcore"."sales_order_lines"."list_rate" <> 'NaN');--> statement-breakpoint
-- Invoices are posted documents (ADR-007 §1, §2; ADR-005 §7b): draft -> posted -> cancelled, cancelled final. While a
-- draft, anything changes; its posting sets its number, entry, frozen issuer and buyer, and figures; after that only
-- the move to cancelled and its cancel columns (M3-10), and the lines not at all. No write-once columns until M5's IRN.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('invoices', 'draft', 'posted'), ('invoices', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.invoices
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('invoices', 'invoice_id', 'draft');
--> statement-breakpoint
-- An invoice is a receivable charge receipts are allocated against (RAD-116, ADR-005 §7a): cancelled only once nothing
-- is applied to it, then registered. Its balance is total less v_document_paid.paid.
CREATE TRIGGER guard_applied_cancel BEFORE UPDATE OF status ON radcore.invoices
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_applied_cancel();
--> statement-breakpoint
INSERT INTO radcore.allocatable_documents (document_table, side, kind) VALUES ('invoices', 'receivable', 'charge');
--> statement-breakpoint
-- ADR-005 §2's identity across rows, once per invoice at commit (RA006): a posted invoice's header figures are its
-- lines' sums, and its total is the lines' total plus its round-off. Noted when its posting update writes the header;
-- its lines are fixed by then (guard_document_line).
CREATE FUNCTION radcore.note_invoice_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT 'invoices', n.id FROM new_rows n WHERE n.status <> 'draft' ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.note_invoice_documents() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER note_document AFTER UPDATE ON radcore.invoices REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_invoice_documents();
--> statement-breakpoint
-- check_document as 0051 left it, with the invoice's identity added at its end (RAD-113).
CREATE OR REPLACE FUNCTION radcore.check_document(doc_table text, doc_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  bad record;
BEGIN
  SELECT t.item_id, t.location_id, sum(t.moved) AS moved, sum(t.booked) AS booked INTO bad FROM (
    SELECT m.item_id, m.location_id, CASE m.direction WHEN 'out' THEN -m.value ELSE m.value END AS moved, 0::numeric AS booked
      FROM radcore.stock_movements m WHERE m.source_table = doc_table AND m.source_id = doc_id
    UNION ALL
    SELECT l.item_id, l.location_id, 0::numeric, l.debit - l.credit
      FROM radcore.journal_lines l JOIN radcore.journal_entries e ON e.id = l.entry_id
      WHERE e.source_table = doc_table AND e.source_id = doc_id AND l.account_control_kind = 'stock') t
    GROUP BY t.item_id, t.location_id HAVING sum(t.moved) <> sum(t.booked) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'document % %: its stock at item % and location % moved %, but its books show %', doc_table, doc_id,
      bad.item_id, bad.location_id, bad.moved, bad.booked USING ERRCODE = 'RA007';
  END IF;
  SELECT m.id, m.qty, (SELECT count(*) FROM radcore.unit_events e WHERE e.out_movement_id = m.id OR e.in_movement_id = m.id) AS n
    INTO bad FROM radcore.stock_movements m JOIN radcore.items i ON i.id = m.item_id AND i.serialised
    WHERE m.source_table = doc_table AND m.source_id = doc_id AND m.direction <> 'revalue'
      AND (SELECT count(*) FROM radcore.unit_events e WHERE e.out_movement_id = m.id OR e.in_movement_id = m.id) <> m.qty
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'stock movement %: % units for a quantity of %', bad.id, bad.n, bad.qty USING ERRCODE = 'RA007';
  END IF;
  SELECT b.movement_id, b.batch_id, b.qty INTO bad FROM radcore.stock_movement_batches b
    JOIN radcore.stock_movements m ON m.id = b.movement_id JOIN radcore.items i ON i.id = m.item_id AND i.serialised
    WHERE m.source_table = doc_table AND m.source_id = doc_id
      AND (SELECT count(*) FROM radcore.unit_events e JOIN radcore.units u ON u.id = e.unit_id
           WHERE (e.out_movement_id = m.id OR e.in_movement_id = m.id) AND u.batch_id IS NOT DISTINCT FROM b.batch_id) <> b.qty
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'stock movement %: its units in batch % don''t number %', bad.movement_id, bad.batch_id, bad.qty
      USING ERRCODE = 'RA007';
  END IF;
  IF doc_table = 'invoices' THEN
    SELECT h.total, s.lines INTO bad FROM radcore.invoices h
      CROSS JOIN LATERAL (SELECT coalesce(sum(l.taxable), 0) AS taxable, coalesce(sum(l.cgst), 0) AS cgst, coalesce(sum(l.sgst), 0) AS sgst,
        coalesce(sum(l.igst), 0) AS igst, coalesce(sum(l.cess_ad_valorem + l.cess_per_unit_amount), 0) AS cess,
        coalesce(sum(l.line_total), 0) AS lines FROM radcore.invoice_lines l WHERE l.invoice_id = h.id) s
      WHERE h.id = doc_id AND h.status <> 'draft' AND (h.taxable <> s.taxable OR h.cgst <> s.cgst OR h.sgst <> s.sgst
        OR h.igst <> s.igst OR h.cess <> s.cess OR h.total <> s.lines + h.round_off);
    IF FOUND THEN
      RAISE EXCEPTION 'invoice %: its header (total %) doesn''t match its lines (%) and round-off', doc_id, bad.total, bad.lines
        USING ERRCODE = 'RA006', CONSTRAINT = 'invoice_lines_total';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
-- A money document is audited in full. The buyer's and ship-to addresses are personal data, as on the party (RAD-40):
-- the trail says they changed, never what they were. A document's lines are its parts (ADR-001 §8b).
SELECT radcore.audit_attach('invoices',
  keep => array['status', 'number', 'party_id', 'owner', 'price_list_id', 'business_date', 'notes', 'ship_to_name', 'ship_to_state_code', 'issuer_legal_name',
    'issuer_gstin', 'issuer_address_line1', 'issuer_address_line2', 'issuer_city', 'issuer_pincode', 'issuer_state_code', 'buyer_name',
    'buyer_gstin', 'buyer_state_code', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'round_off', 'total',
    'override_version', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id'],
  redact => array['ship_to_address', 'buyer_address_line1', 'buyer_address_line2', 'buyer_city', 'buyer_pincode']);
--> statement-breakpoint
SELECT radcore.audit_attach('invoice_lines', keep => array['invoice_id', 'line_no', 'delivery_line_id', 'item_id', 'qty', 'rate',
  'discount_percent', 'list_rate', 'list_version_id', 'hsn', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'cess_ad_valorem', 'cess_per_unit_amount',
  'line_total', 'cost', 'delivery_taxable', 'delivery_gst'], owner => 'invoice_id', owner_table => 'invoices');
--> statement-breakpoint
-- A party's price list (the architect on RAD-113), set under prices:approve: audited, as a price is.
SELECT radcore.audit_attach('party_price_lists', keep => array['party_id', 'price_list_id']);
--> statement-breakpoint
-- Orders now copy their price list and each line its list rate (Refs RAD-112): attached again, with those kept.
SELECT radcore.audit_attach('sales_orders', keep => array['number', 'party_id', 'price_list_id', 'quote_id', 'business_date', 'status',
  'notes', 'close_reason', 'override_version']);
--> statement-breakpoint
SELECT radcore.audit_attach('sales_order_lines', keep => array['order_id', 'line_no', 'item_id', 'qty', 'rate', 'discount_percent',
  'list_rate', 'list_version_id'], owner => 'order_id', owner_table => 'sales_orders');
--> statement-breakpoint
-- A posted invoice is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.invoices, radcore.invoice_lines FROM radcore_app;
--> statement-breakpoint
-- invoices:write and invoices:cancel (RAD-113, the architect's ruling), ordinary catalogue keys any role can be given
-- (Sarthak: dynamic, by owner and admin). The starting grants, in each role's template too (RAD-83): accounts and the
-- counter bill, and the owner; cancelling is kept from the counter. The admin holds every key, as it must to give any
-- role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'invoices:write', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter']) AS r
UNION ALL SELECT r, 'invoices:cancel', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'invoices:write', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter']) AS r
UNION ALL SELECT r, 'invoices:cancel', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
