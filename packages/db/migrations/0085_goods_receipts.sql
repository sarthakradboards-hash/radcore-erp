CREATE TABLE "radcore"."goods_receipt_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"received" numeric(18, 3) NOT NULL,
	"accepted" numeric(18, 3),
	"rejected" numeric(18, 3),
	"rate" numeric(18, 6),
	"accepted_value" numeric(18, 2),
	"rejected_value" numeric(18, 2),
	"reject_reason" text,
	"accepted_movement_id" uuid,
	"rejected_movement_id" uuid,
	"qc" jsonb,
	CONSTRAINT "ck_goods_receipt_lines_received" CHECK ("radcore"."goods_receipt_lines"."received" > 0 and "radcore"."goods_receipt_lines"."received" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_accepted" CHECK ("radcore"."goods_receipt_lines"."accepted" >= 0 and "radcore"."goods_receipt_lines"."accepted" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_rejected" CHECK ("radcore"."goods_receipt_lines"."rejected" >= 0 and "radcore"."goods_receipt_lines"."rejected" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_rate" CHECK ("radcore"."goods_receipt_lines"."rate" >= 0 and "radcore"."goods_receipt_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_accepted_value" CHECK ("radcore"."goods_receipt_lines"."accepted_value" >= 0 and "radcore"."goods_receipt_lines"."accepted_value" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_rejected_value" CHECK ("radcore"."goods_receipt_lines"."rejected_value" >= 0 and "radcore"."goods_receipt_lines"."rejected_value" <> 'NaN'),
	CONSTRAINT "ck_goods_receipt_lines_reject_reason" CHECK (char_length("radcore"."goods_receipt_lines"."reject_reason") <= 300),
	CONSTRAINT "ck_goods_receipt_lines_qc" CHECK (num_nulls("radcore"."goods_receipt_lines"."accepted", "radcore"."goods_receipt_lines"."rejected", "radcore"."goods_receipt_lines"."rate", "radcore"."goods_receipt_lines"."accepted_value", "radcore"."goods_receipt_lines"."rejected_value", "radcore"."goods_receipt_lines"."qc") in (0, 6)
    and ("radcore"."goods_receipt_lines"."accepted" is null or "radcore"."goods_receipt_lines"."accepted" + "radcore"."goods_receipt_lines"."rejected" = "radcore"."goods_receipt_lines"."received")
    and ("radcore"."goods_receipt_lines"."accepted" is null or ("radcore"."goods_receipt_lines"."accepted" > 0) = ("radcore"."goods_receipt_lines"."accepted_movement_id" is not null))
    and ("radcore"."goods_receipt_lines"."rejected" is null or ("radcore"."goods_receipt_lines"."rejected" > 0) = ("radcore"."goods_receipt_lines"."rejected_movement_id" is not null))
    and (coalesce("radcore"."goods_receipt_lines"."rejected", 0) = 0 or "radcore"."goods_receipt_lines"."reject_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."goods_receipts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"order_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"location_id" uuid NOT NULL,
	"rejects_location_id" uuid NOT NULL,
	"supplier_ref" text,
	"notes" text,
	"value" numeric(18, 2),
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "goods_receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_goods_receipts_supplier_ref" CHECK (char_length("radcore"."goods_receipts"."supplier_ref") <= 60),
	CONSTRAINT "ck_goods_receipts_notes" CHECK (char_length("radcore"."goods_receipts"."notes") <= 500),
	CONSTRAINT "ck_goods_receipts_value" CHECK ("radcore"."goods_receipts"."value" >= 0 and "radcore"."goods_receipts"."value" <> 'NaN'),
	CONSTRAINT "ck_goods_receipts_cancel_reason" CHECK (char_length("radcore"."goods_receipts"."cancel_reason") <= 500),
	CONSTRAINT "ck_goods_receipts_status" CHECK ("radcore"."goods_receipts"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_goods_receipts_places" CHECK ("radcore"."goods_receipts"."location_id" <> "radcore"."goods_receipts"."rejects_location_id"),
	CONSTRAINT "ck_goods_receipts_posted" CHECK (("radcore"."goods_receipts"."status" = 'draft') = ("radcore"."goods_receipts"."number" is null) and ("radcore"."goods_receipts"."status" = 'draft') = ("radcore"."goods_receipts"."value" is null)
    and ("radcore"."goods_receipts"."status" <> 'draft' or "radcore"."goods_receipts"."posted_entry_id" is null)),
	CONSTRAINT "ck_goods_receipts_cancelled" CHECK (("radcore"."goods_receipts"."status" = 'cancelled') = ("radcore"."goods_receipts"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "radcore"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "radcore"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_accepted_movement_id_stock_movements_id_fk" FOREIGN KEY ("accepted_movement_id") REFERENCES "radcore"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_rejected_movement_id_stock_movements_id_fk" FOREIGN KEY ("rejected_movement_id") REFERENCES "radcore"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_rejects_location_id_locations_id_fk" FOREIGN KEY ("rejects_location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."goods_receipts" ADD CONSTRAINT "goods_receipts_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_goods_receipt_lines_line" ON "radcore"."goods_receipt_lines" USING btree ("receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_order_line" ON "radcore"."goods_receipt_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_item" ON "radcore"."goods_receipt_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_accepted_movement" ON "radcore"."goods_receipt_lines" USING btree ("accepted_movement_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_rejected_movement" ON "radcore"."goods_receipt_lines" USING btree ("rejected_movement_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_date" ON "radcore"."goods_receipts" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_order" ON "radcore"."goods_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_party" ON "radcore"."goods_receipts" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_location" ON "radcore"."goods_receipts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_rejects_location" ON "radcore"."goods_receipts" USING btree ("rejects_location_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_created_by" ON "radcore"."goods_receipts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_posted_entry" ON "radcore"."goods_receipts" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_cancel_entry" ON "radcore"."goods_receipts" USING btree ("cancel_entry_id");--> statement-breakpoint
-- RAD-137 (M4-02; ADR-008 §1, §2, §6, §13): goods receipts. A posted document (ADR-005 §7b): draft -> posted ->
-- cancelled, cancelled final. While a draft, anything changes; its posting sets its number, value, entry and its lines'
-- QC; after that only the move to cancelled and its cancel columns, and the lines not at all. A purchase order its
-- receipts closed opens again when a cancelled receipt brings a line back below what was ordered (closed -> placed, as
-- sales orders do); lib-common's STATE_TRANSITIONS holds the same, and tools/posted-documents.test.ts the two equal.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('goods_receipts', 'draft', 'posted'), ('goods_receipts', 'posted', 'cancelled'), ('purchase_orders', 'closed', 'placed');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('goods_receipts', 'receipt_id', 'draft');
--> statement-breakpoint
-- Receipts are audited in full; their lines are their parts (ADR-001 §8b).
SELECT radcore.audit_attach('goods_receipts', keep => array['status', 'number', 'order_id', 'party_id', 'business_date', 'location_id',
  'rejects_location_id', 'supplier_ref', 'notes', 'value', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason',
  'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('goods_receipt_lines', keep => array['receipt_id', 'line_no', 'order_line_id', 'item_id', 'received', 'accepted',
  'rejected', 'rate', 'accepted_value', 'rejected_value', 'reject_reason', 'accepted_movement_id', 'rejected_movement_id', 'qc'],
  owner => 'receipt_id', owner_table => 'goods_receipts');
--> statement-breakpoint
-- A posted receipt is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.goods_receipts, radcore.goods_receipt_lines FROM radcore_app;
--> statement-breakpoint
-- inward:write and inward:qc (ADR-008 §13): ordinary catalogue keys, no second factor (D-19), neither all-only. The
-- starting grants, in each role's template too (RAD-83): the stores record and inspect; the admin holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'inward:write', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'inward:qc', 'all' FROM unnest(array['admin', 'stores']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'inward:write', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'inward:qc', 'all' FROM unnest(array['admin', 'stores']) AS r
ON CONFLICT DO NOTHING;
