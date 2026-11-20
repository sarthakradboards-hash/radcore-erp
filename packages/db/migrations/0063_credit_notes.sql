CREATE TABLE "radcore"."credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3),
	"picks" jsonb,
	"taxable" numeric(18, 2),
	"gst_rate" numeric(9, 6),
	"gst_rate_source" text,
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"igst" numeric(18, 2),
	"line_total" numeric(18, 2),
	"cost" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_credit_note_lines_qty" CHECK ("radcore"."credit_note_lines"."qty" > 0 and "radcore"."credit_note_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_taxable" CHECK ("radcore"."credit_note_lines"."taxable" >= 0 and "radcore"."credit_note_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_gst_rate" CHECK ("radcore"."credit_note_lines"."gst_rate" between 0 and 100 and "radcore"."credit_note_lines"."gst_rate" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_gst_rate_source" CHECK (char_length("radcore"."credit_note_lines"."gst_rate_source") <= 200),
	CONSTRAINT "ck_credit_note_lines_cgst" CHECK ("radcore"."credit_note_lines"."cgst" >= 0 and "radcore"."credit_note_lines"."cgst" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_sgst" CHECK ("radcore"."credit_note_lines"."sgst" >= 0 and "radcore"."credit_note_lines"."sgst" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_igst" CHECK ("radcore"."credit_note_lines"."igst" >= 0 and "radcore"."credit_note_lines"."igst" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_line_total" CHECK ("radcore"."credit_note_lines"."line_total" >= 0 and "radcore"."credit_note_lines"."line_total" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_cost" CHECK ("radcore"."credit_note_lines"."cost" >= 0 and "radcore"."credit_note_lines"."cost" <> 'NaN'),
	CONSTRAINT "ck_credit_note_lines_kind" CHECK (("radcore"."credit_note_lines"."qty" is null) = ("radcore"."credit_note_lines"."picks" is null) and ("radcore"."credit_note_lines"."qty" is not null or "radcore"."credit_note_lines"."taxable" is not null)),
	CONSTRAINT "ck_credit_note_lines_posted" CHECK (num_nulls("radcore"."credit_note_lines"."gst_rate", "radcore"."credit_note_lines"."gst_rate_source", "radcore"."credit_note_lines"."cgst", "radcore"."credit_note_lines"."sgst", "radcore"."credit_note_lines"."igst", "radcore"."credit_note_lines"."line_total", "radcore"."credit_note_lines"."cost") in (0, 7)
    and ("radcore"."credit_note_lines"."line_total" is null or "radcore"."credit_note_lines"."taxable" is not null)),
	CONSTRAINT "ck_credit_note_lines_identity" CHECK ("radcore"."credit_note_lines"."line_total" = "radcore"."credit_note_lines"."taxable" + "radcore"."credit_note_lines"."cgst" + "radcore"."credit_note_lines"."sgst" + "radcore"."credit_note_lines"."igst"
    and "radcore"."credit_note_lines"."cgst" = "radcore"."credit_note_lines"."sgst" and ("radcore"."credit_note_lines"."igst" = 0 or "radcore"."credit_note_lines"."cgst" = 0))
);
--> statement-breakpoint
CREATE TABLE "radcore"."credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"kind" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"business_date" date NOT NULL,
	"location_id" uuid,
	"reason" text NOT NULL,
	"refund_amount" numeric(18, 2),
	"refund_account_id" uuid,
	"late" boolean DEFAULT false NOT NULL,
	"taxable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "credit_notes_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_credit_notes_reason" CHECK (char_length("radcore"."credit_notes"."reason") <= 500),
	CONSTRAINT "ck_credit_notes_refund_amount" CHECK ("radcore"."credit_notes"."refund_amount" >= 0 and "radcore"."credit_notes"."refund_amount" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_taxable" CHECK ("radcore"."credit_notes"."taxable" >= 0 and "radcore"."credit_notes"."taxable" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_cgst" CHECK ("radcore"."credit_notes"."cgst" >= 0 and "radcore"."credit_notes"."cgst" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_sgst" CHECK ("radcore"."credit_notes"."sgst" >= 0 and "radcore"."credit_notes"."sgst" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_igst" CHECK ("radcore"."credit_notes"."igst" >= 0 and "radcore"."credit_notes"."igst" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_round_off" CHECK ("radcore"."credit_notes"."round_off" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_total" CHECK ("radcore"."credit_notes"."total" >= 0 and "radcore"."credit_notes"."total" <> 'NaN'),
	CONSTRAINT "ck_credit_notes_cancel_reason" CHECK (char_length("radcore"."credit_notes"."cancel_reason") <= 500),
	CONSTRAINT "ck_credit_notes_status" CHECK ("radcore"."credit_notes"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_credit_notes_kind" CHECK ("radcore"."credit_notes"."kind" in ('value', 'goods') and ("radcore"."credit_notes"."kind" = 'goods') = ("radcore"."credit_notes"."location_id" is not null)),
	CONSTRAINT "ck_credit_notes_posted" CHECK (("radcore"."credit_notes"."status" = 'draft') = ("radcore"."credit_notes"."number" is null) and ("radcore"."credit_notes"."status" = 'draft') = ("radcore"."credit_notes"."posted_entry_id" is null)),
	CONSTRAINT "ck_credit_notes_cancelled" CHECK (("radcore"."credit_notes"."status" = 'cancelled') = ("radcore"."credit_notes"."cancelled_at" is not null)),
	CONSTRAINT "ck_credit_notes_refund" CHECK (("radcore"."credit_notes"."refund_amount" is null) = ("radcore"."credit_notes"."refund_account_id" is null) and coalesce("radcore"."credit_notes"."refund_amount", 1) > 0),
	CONSTRAINT "ck_credit_notes_identity" CHECK ("radcore"."credit_notes"."total" = "radcore"."credit_notes"."taxable" + "radcore"."credit_notes"."cgst" + "radcore"."credit_notes"."sgst" + "radcore"."credit_notes"."igst" + "radcore"."credit_notes"."round_off"
    and abs("radcore"."credit_notes"."round_off") < 1 and "radcore"."credit_notes"."cgst" = "radcore"."credit_notes"."sgst" and ("radcore"."credit_notes"."igst" = 0 or "radcore"."credit_notes"."cgst" = 0))
);
--> statement-breakpoint
ALTER TABLE "radcore"."credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "radcore"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "radcore"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_note_lines" ADD CONSTRAINT "credit_note_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "radcore"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_refund_account_id_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."credit_notes" ADD CONSTRAINT "credit_notes_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_credit_note_lines_line" ON "radcore"."credit_note_lines" USING btree ("credit_note_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_credit_note_lines_invoice_line" ON "radcore"."credit_note_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "ix_credit_note_lines_item" ON "radcore"."credit_note_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_invoice" ON "radcore"."credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_party_date" ON "radcore"."credit_notes" USING btree ("party_id","business_date");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_date" ON "radcore"."credit_notes" USING btree ("business_date","id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_owner" ON "radcore"."credit_notes" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_location" ON "radcore"."credit_notes" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_refund_account" ON "radcore"."credit_notes" USING btree ("refund_account_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_posted_entry" ON "radcore"."credit_notes" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_cancel_entry" ON "radcore"."credit_notes" USING btree ("cancel_entry_id");
--> statement-breakpoint
-- RAD-114 PR 2 (M3-10; ADR-007 §6; ADR-006 §6, F9, F25, F26): credit notes. Posted documents (ADR-005 §7b): draft ->
-- posted -> cancelled, cancelled final. While a draft, anything changes; its posting sets its number, entry, lateness
-- and figures; after that only the move to cancelled and its cancel columns, and the lines not at all.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('credit_notes', 'draft', 'posted'), ('credit_notes', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.credit_notes
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('credit_notes', 'credit_note_id', 'draft');
--> statement-breakpoint
-- A credit note is a receivable credit (ADR-005 §7a): applied to its invoice as it posts, the rest refunded or applied
-- later. Cancelled only once nothing is applied or refunded from it, then registered.
CREATE TRIGGER guard_applied_cancel BEFORE UPDATE OF status ON radcore.credit_notes
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_applied_cancel();
--> statement-breakpoint
INSERT INTO radcore.allocatable_documents (document_table, side, kind) VALUES ('credit_notes', 'receivable', 'credit');
--> statement-breakpoint
-- ADR-005 §2's identity across rows, once per note at commit (RA006), as an invoice's: a posted note's header figures
-- are its lines' sums, and its total is the lines' total plus its round-off.
CREATE FUNCTION radcore.note_credit_note_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT 'credit_notes', n.id FROM new_rows n WHERE n.status <> 'draft' ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.note_credit_note_documents() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER note_document AFTER UPDATE ON radcore.credit_notes REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_credit_note_documents();
--> statement-breakpoint
-- check_document as 0059 left it, with the credit note's identity added at its end (RAD-114).
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
  IF doc_table = 'credit_notes' THEN
    SELECT h.total, s.lines INTO bad FROM radcore.credit_notes h
      CROSS JOIN LATERAL (SELECT coalesce(sum(l.taxable), 0) AS taxable, coalesce(sum(l.cgst), 0) AS cgst, coalesce(sum(l.sgst), 0) AS sgst,
        coalesce(sum(l.igst), 0) AS igst, coalesce(sum(l.line_total), 0) AS lines FROM radcore.credit_note_lines l WHERE l.credit_note_id = h.id) s
      WHERE h.id = doc_id AND h.status <> 'draft' AND (h.taxable <> s.taxable OR h.cgst <> s.cgst OR h.sgst <> s.sgst
        OR h.igst <> s.igst OR h.total <> s.lines + h.round_off);
    IF FOUND THEN
      RAISE EXCEPTION 'credit note %: its header (total %) doesn''t match its lines (%) and round-off', doc_id, bad.total, bad.lines
        USING ERRCODE = 'RA006', CONSTRAINT = 'credit_note_lines_total';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
-- A money document is audited in full; a note's lines are its parts (ADR-001 §8b).
SELECT radcore.audit_attach('credit_notes',
  keep => array['status', 'number', 'kind', 'invoice_id', 'party_id', 'owner', 'business_date', 'location_id', 'reason', 'refund_amount',
    'refund_account_id', 'late', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total', 'posted_entry_id', 'cancelled_at', 'cancelled_by',
    'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('credit_note_lines', keep => array['credit_note_id', 'line_no', 'invoice_line_id', 'item_id', 'qty', 'picks',
  'taxable', 'gst_rate', 'gst_rate_source', 'cgst', 'sgst', 'igst', 'line_total', 'cost'], owner => 'credit_note_id', owner_table => 'credit_notes');
--> statement-breakpoint
-- A posted note is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.credit_notes, radcore.credit_note_lines FROM radcore_app;
--> statement-breakpoint
-- F25's account: output tax a late credit note can no longer cut is the business's cost (lib-common's SYSTEM_ACCOUNTS).
INSERT INTO radcore.accounts (system_key, name, type, control_kind) VALUES
  ('late_cn_gst', 'GST Borne on Late Credit Notes', 'expense', 'none');
--> statement-breakpoint
-- credit_notes:write and credit_notes:approve (RAD-114, the architect's ruling; the second factor on approve, Sarthak 20
-- Nov), ordinary catalogue keys any role can be given. The starting grants, in each role's template too (RAD-83):
-- accounts and the counter draft, accounts and the owner approve. The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'credit_notes:write', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter']) AS r
UNION ALL SELECT r, 'credit_notes:approve', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'credit_notes:write', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter']) AS r
UNION ALL SELECT r, 'credit_notes:approve', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
