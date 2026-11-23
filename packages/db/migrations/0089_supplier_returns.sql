CREATE TABLE "radcore"."supplier_return_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"rate" numeric(18, 6),
	"unbilled_qty" numeric(18, 3),
	"unbilled_value" numeric(18, 2),
	"movement_id" uuid,
	CONSTRAINT "ck_supplier_return_lines_qty" CHECK ("radcore"."supplier_return_lines"."qty" > 0 and "radcore"."supplier_return_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_lines_rate" CHECK ("radcore"."supplier_return_lines"."rate" >= 0 and "radcore"."supplier_return_lines"."rate" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_lines_unbilled_qty" CHECK ("radcore"."supplier_return_lines"."unbilled_qty" >= 0 and "radcore"."supplier_return_lines"."unbilled_qty" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_lines_unbilled_value" CHECK ("radcore"."supplier_return_lines"."unbilled_value" >= 0 and "radcore"."supplier_return_lines"."unbilled_value" <> 'NaN'),
	CONSTRAINT "ck_supplier_return_lines_posted" CHECK (num_nulls("radcore"."supplier_return_lines"."rate", "radcore"."supplier_return_lines"."unbilled_qty", "radcore"."supplier_return_lines"."unbilled_value", "radcore"."supplier_return_lines"."movement_id") in (0, 4)
    and ("radcore"."supplier_return_lines"."unbilled_qty" is null or "radcore"."supplier_return_lines"."unbilled_qty" <= "radcore"."supplier_return_lines"."qty"))
);
--> statement-breakpoint
CREATE TABLE "radcore"."supplier_returns" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"party_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"location_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"unbilled_value" numeric(18, 2),
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "supplier_returns_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_supplier_returns_reason" CHECK (char_length("radcore"."supplier_returns"."reason") <= 500),
	CONSTRAINT "ck_supplier_returns_notes" CHECK (char_length("radcore"."supplier_returns"."notes") <= 500),
	CONSTRAINT "ck_supplier_returns_unbilled_value" CHECK ("radcore"."supplier_returns"."unbilled_value" >= 0 and "radcore"."supplier_returns"."unbilled_value" <> 'NaN'),
	CONSTRAINT "ck_supplier_returns_cancel_reason" CHECK (char_length("radcore"."supplier_returns"."cancel_reason") <= 500),
	CONSTRAINT "ck_supplier_returns_status" CHECK ("radcore"."supplier_returns"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_supplier_returns_posted" CHECK (("radcore"."supplier_returns"."status" = 'draft') = ("radcore"."supplier_returns"."number" is null) and ("radcore"."supplier_returns"."status" = 'draft') = ("radcore"."supplier_returns"."unbilled_value" is null)
    and ("radcore"."supplier_returns"."status" <> 'draft' or "radcore"."supplier_returns"."posted_entry_id" is null)),
	CONSTRAINT "ck_supplier_returns_cancelled" CHECK (("radcore"."supplier_returns"."status" = 'cancelled') = ("radcore"."supplier_returns"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "radcore"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "radcore"."goods_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "radcore"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "supplier_returns_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "supplier_returns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "supplier_returns_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."supplier_returns" ADD CONSTRAINT "supplier_returns_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_return_lines_line" ON "radcore"."supplier_return_lines" USING btree ("return_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_lines_receipt_line" ON "radcore"."supplier_return_lines" USING btree ("receipt_line_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_lines_item" ON "radcore"."supplier_return_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_lines_movement" ON "radcore"."supplier_return_lines" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_date" ON "radcore"."supplier_returns" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_party" ON "radcore"."supplier_returns" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_location" ON "radcore"."supplier_returns" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_created_by" ON "radcore"."supplier_returns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_posted_entry" ON "radcore"."supplier_returns" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_cancel_entry" ON "radcore"."supplier_returns" USING btree ("cancel_entry_id");--> statement-breakpoint
-- RAD-140 (M4-05; ADR-008 §1, §2, §8, §13): supplier returns. A posted document (ADR-005 §7b): draft -> posted ->
-- cancelled, cancelled final. While a draft, anything changes; its posting sets its number, value, entry and its lines'
-- split; after that only the move to cancelled and its cancel columns, and the lines not at all. A purchase order its
-- receipts closed opens again when a return brings a line back below what was ordered (closed -> placed, 0085's move).
-- lib-common's STATE_TRANSITIONS holds the same, and tools/posted-documents.test.ts the two equal.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('supplier_returns', 'draft', 'posted'), ('supplier_returns', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.supplier_returns
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.supplier_return_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('supplier_returns', 'return_id', 'draft');
--> statement-breakpoint
-- Returns are audited in full; their lines are their parts (ADR-001 §8b).
SELECT radcore.audit_attach('supplier_returns', keep => array['status', 'number', 'party_id', 'business_date', 'location_id', 'reason',
  'notes', 'unbilled_value', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('supplier_return_lines', keep => array['return_id', 'line_no', 'receipt_line_id', 'item_id', 'qty', 'picks', 'rate',
  'unbilled_qty', 'unbilled_value', 'movement_id'], owner => 'return_id', owner_table => 'supplier_returns');
--> statement-breakpoint
-- A posted return is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.supplier_returns, radcore.supplier_return_lines FROM radcore_app;
--> statement-breakpoint
-- supplier_returns:write (ADR-008 §13): an ordinary catalogue key, no second factor (D-19), not all-only. The stores
-- send rejects back, accounts raise the debit notes, and the admin holds every key; in each role's template too (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'supplier_returns:write', 'all' FROM unnest(array['admin', 'stores', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'supplier_returns:write', 'all' FROM unnest(array['admin', 'stores', 'accounts']) AS r
ON CONFLICT DO NOTHING;
