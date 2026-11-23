CREATE TABLE "radcore"."stock_adjustment_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"direction" text NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"condition" text,
	"value" numeric(18, 2),
	CONSTRAINT "ck_stock_adjustment_lines_qty" CHECK ("radcore"."stock_adjustment_lines"."qty" > 0 and "radcore"."stock_adjustment_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_stock_adjustment_lines_value" CHECK ("radcore"."stock_adjustment_lines"."value" >= 0 and "radcore"."stock_adjustment_lines"."value" <> 'NaN'),
	CONSTRAINT "ck_stock_adjustment_lines_direction" CHECK ("radcore"."stock_adjustment_lines"."direction" in ('in', 'out')),
	CONSTRAINT "ck_stock_adjustment_lines_condition" CHECK ("radcore"."stock_adjustment_lines"."condition" is null or "radcore"."stock_adjustment_lines"."direction" = 'in')
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_adjustments" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "stock_adjustments_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_stock_adjustments_reason" CHECK (char_length("radcore"."stock_adjustments"."reason") <= 500),
	CONSTRAINT "ck_stock_adjustments_cancel_reason" CHECK (char_length("radcore"."stock_adjustments"."cancel_reason") <= 500),
	CONSTRAINT "ck_stock_adjustments_status" CHECK ("radcore"."stock_adjustments"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_stock_adjustments_posted" CHECK (("radcore"."stock_adjustments"."status" = 'draft') = ("radcore"."stock_adjustments"."number" is null) and ("radcore"."stock_adjustments"."status" <> 'draft' or "radcore"."stock_adjustments"."posted_entry_id" is null)),
	CONSTRAINT "ck_stock_adjustments_cancelled" CHECK (("radcore"."stock_adjustments"."status" = 'cancelled') = ("radcore"."stock_adjustments"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_count_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"found" numeric(18, 3) NOT NULL,
	"serials" jsonb NOT NULL,
	"book" numeric(18, 3),
	"difference" numeric(18, 3),
	"value" numeric(18, 2),
	CONSTRAINT "ux_stock_count_lines_item_batch" UNIQUE NULLS NOT DISTINCT("count_id","item_id","batch_id"),
	CONSTRAINT "ck_stock_count_lines_found" CHECK ("radcore"."stock_count_lines"."found" >= 0 and "radcore"."stock_count_lines"."found" <> 'NaN'),
	CONSTRAINT "ck_stock_count_lines_book" CHECK ("radcore"."stock_count_lines"."book" <> 'NaN'),
	CONSTRAINT "ck_stock_count_lines_difference" CHECK ("radcore"."stock_count_lines"."difference" <> 'NaN'),
	CONSTRAINT "ck_stock_count_lines_value" CHECK ("radcore"."stock_count_lines"."value" <> 'NaN'),
	CONSTRAINT "ck_stock_count_lines_posted" CHECK (num_nulls("radcore"."stock_count_lines"."book", "radcore"."stock_count_lines"."difference", "radcore"."stock_count_lines"."value") in (0, 3))
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_counts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "stock_counts_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_stock_counts_reason" CHECK (char_length("radcore"."stock_counts"."reason") <= 500),
	CONSTRAINT "ck_stock_counts_cancel_reason" CHECK (char_length("radcore"."stock_counts"."cancel_reason") <= 500),
	CONSTRAINT "ck_stock_counts_status" CHECK ("radcore"."stock_counts"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_stock_counts_posted" CHECK (("radcore"."stock_counts"."status" = 'draft') = ("radcore"."stock_counts"."number" is null) and ("radcore"."stock_counts"."status" <> 'draft' or "radcore"."stock_counts"."posted_entry_id" is null)),
	CONSTRAINT "ck_stock_counts_cancelled" CHECK (("radcore"."stock_counts"."status" = 'cancelled') = ("radcore"."stock_counts"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_transfer_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"value" numeric(18, 2),
	CONSTRAINT "ck_stock_transfer_lines_qty" CHECK ("radcore"."stock_transfer_lines"."qty" > 0 and "radcore"."stock_transfer_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_stock_transfer_lines_value" CHECK ("radcore"."stock_transfer_lines"."value" >= 0 and "radcore"."stock_transfer_lines"."value" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_transfers" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "stock_transfers_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_stock_transfers_reason" CHECK (char_length("radcore"."stock_transfers"."reason") <= 500),
	CONSTRAINT "ck_stock_transfers_cancel_reason" CHECK (char_length("radcore"."stock_transfers"."cancel_reason") <= 500),
	CONSTRAINT "ck_stock_transfers_status" CHECK ("radcore"."stock_transfers"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_stock_transfers_places" CHECK ("radcore"."stock_transfers"."from_id" <> "radcore"."stock_transfers"."to_id"),
	CONSTRAINT "ck_stock_transfers_posted" CHECK (("radcore"."stock_transfers"."status" = 'draft') = ("radcore"."stock_transfers"."number" is null) and ("radcore"."stock_transfers"."status" <> 'draft' or "radcore"."stock_transfers"."posted_entry_id" is null)),
	CONSTRAINT "ck_stock_transfers_cancelled" CHECK (("radcore"."stock_transfers"."status" = 'cancelled') = ("radcore"."stock_transfers"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "radcore"."stock_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_adjustments" ADD CONSTRAINT "stock_adjustments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_adjustments" ADD CONSTRAINT "stock_adjustments_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_adjustments" ADD CONSTRAINT "stock_adjustments_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "radcore"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "radcore"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_counts" ADD CONSTRAINT "stock_counts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_counts" ADD CONSTRAINT "stock_counts_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_counts" ADD CONSTRAINT "stock_counts_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "radcore"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD CONSTRAINT "stock_transfers_from_id_locations_id_fk" FOREIGN KEY ("from_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD CONSTRAINT "stock_transfers_to_id_locations_id_fk" FOREIGN KEY ("to_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD CONSTRAINT "stock_transfers_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD CONSTRAINT "stock_transfers_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stock_adjustment_lines_line" ON "radcore"."stock_adjustment_lines" USING btree ("adjustment_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustment_lines_item" ON "radcore"."stock_adjustment_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustments_date" ON "radcore"."stock_adjustments" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustments_location" ON "radcore"."stock_adjustments" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustments_created_by" ON "radcore"."stock_adjustments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustments_posted_entry" ON "radcore"."stock_adjustments" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_stock_adjustments_cancel_entry" ON "radcore"."stock_adjustments" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stock_count_lines_line" ON "radcore"."stock_count_lines" USING btree ("count_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_stock_count_lines_item" ON "radcore"."stock_count_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_stock_count_lines_batch" ON "radcore"."stock_count_lines" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_stock_counts_date" ON "radcore"."stock_counts" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_stock_counts_location" ON "radcore"."stock_counts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_stock_counts_created_by" ON "radcore"."stock_counts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_stock_counts_posted_entry" ON "radcore"."stock_counts" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_stock_counts_cancel_entry" ON "radcore"."stock_counts" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stock_transfer_lines_line" ON "radcore"."stock_transfer_lines" USING btree ("transfer_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_stock_transfer_lines_item" ON "radcore"."stock_transfer_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_date" ON "radcore"."stock_transfers" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_from" ON "radcore"."stock_transfers" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_to" ON "radcore"."stock_transfers" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_created_by" ON "radcore"."stock_transfers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_posted_entry" ON "radcore"."stock_transfers" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_stock_transfers_cancel_entry" ON "radcore"."stock_transfers" USING btree ("cancel_entry_id");--> statement-breakpoint
-- RAD-141 (M4-06; ADR-008 §1, §2, §9, §10, §13): stock transfers, counts and adjustments. Posted documents (ADR-005
-- §7b): draft -> posted -> cancelled, cancelled final. While a draft, anything changes; its posting sets its number,
-- entry and figures; after that only the move to cancelled and its cancel columns, and the lines not at all.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('stock_transfers', 'draft', 'posted'), ('stock_transfers', 'posted', 'cancelled'),
  ('stock_counts', 'draft', 'posted'), ('stock_counts', 'posted', 'cancelled'),
  ('stock_adjustments', 'draft', 'posted'), ('stock_adjustments', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('stock_transfers', 'transfer_id', 'draft');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_counts
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('stock_counts', 'count_id', 'draft');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.stock_adjustment_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('stock_adjustments', 'adjustment_id', 'draft');
--> statement-breakpoint
-- Stock documents are audited in full; their lines are their parts (ADR-001 §8b), so an approval sees a line's change as
-- the document's.
SELECT radcore.audit_attach('stock_transfers', keep => array['status', 'number', 'from_id', 'to_id', 'business_date', 'reason',
  'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('stock_transfer_lines', keep => array['transfer_id', 'line_no', 'item_id', 'qty', 'picks', 'value'],
  owner => 'transfer_id', owner_table => 'stock_transfers');
--> statement-breakpoint
SELECT radcore.audit_attach('stock_counts', keep => array['status', 'number', 'location_id', 'counted_at', 'business_date', 'reason',
  'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('stock_count_lines', keep => array['count_id', 'line_no', 'item_id', 'batch_id', 'found', 'serials', 'book',
  'difference', 'value'], owner => 'count_id', owner_table => 'stock_counts');
--> statement-breakpoint
SELECT radcore.audit_attach('stock_adjustments', keep => array['status', 'number', 'location_id', 'business_date', 'reason',
  'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('stock_adjustment_lines', keep => array['adjustment_id', 'line_no', 'direction', 'item_id', 'qty', 'picks',
  'condition', 'value'], owner => 'adjustment_id', owner_table => 'stock_adjustments');
--> statement-breakpoint
-- A posted document is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.stock_transfers, radcore.stock_transfer_lines, radcore.stock_counts, radcore.stock_count_lines,
  radcore.stock_adjustments, radcore.stock_adjustment_lines FROM radcore_app;
--> statement-breakpoint
-- stock:move, stock:count and stock:approve (ADR-008 §13): ordinary catalogue keys, no second factor (D-19), none
-- all-only. The starting grants, in each role's template too (RAD-83): the stores move and count, the owner approves,
-- and the admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'stock:move', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'stock:count', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'stock:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'stock:move', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'stock:count', 'all' FROM unnest(array['admin', 'stores']) AS r
UNION ALL SELECT r, 'stock:approve', 'all' FROM unnest(array['admin', 'owner']) AS r
ON CONFLICT DO NOTHING;
