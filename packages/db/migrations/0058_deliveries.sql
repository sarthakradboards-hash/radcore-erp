CREATE TABLE "radcore"."deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"order_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"notes" text,
	"owner" text NOT NULL,
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
	CONSTRAINT "deliveries_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_deliveries_notes" CHECK (char_length("radcore"."deliveries"."notes") <= 500),
	CONSTRAINT "ck_deliveries_cancel_reason" CHECK (char_length("radcore"."deliveries"."cancel_reason") <= 500),
	CONSTRAINT "ck_deliveries_status" CHECK ("radcore"."deliveries"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_deliveries_posted" CHECK (("radcore"."deliveries"."status" = 'draft') = ("radcore"."deliveries"."number" is null) and ("radcore"."deliveries"."status" <> 'draft' or "radcore"."deliveries"."posted_entry_id" is null)),
	CONSTRAINT "ck_deliveries_cancelled" CHECK (("radcore"."deliveries"."status" = 'cancelled') = ("radcore"."deliveries"."cancel_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"value" numeric(18, 2),
	"taxable" numeric(18, 2),
	"gst" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_delivery_lines_qty" CHECK ("radcore"."delivery_lines"."qty" > 0 and "radcore"."delivery_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_delivery_lines_value" CHECK ("radcore"."delivery_lines"."value" >= 0 and "radcore"."delivery_lines"."value" <> 'NaN'),
	CONSTRAINT "ck_delivery_lines_taxable" CHECK ("radcore"."delivery_lines"."taxable" >= 0 and "radcore"."delivery_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_delivery_lines_gst" CHECK ("radcore"."delivery_lines"."gst" >= 0 and "radcore"."delivery_lines"."gst" <> 'NaN'),
	CONSTRAINT "ck_delivery_lines_posted" CHECK (("radcore"."delivery_lines"."value" is null) = ("radcore"."delivery_lines"."taxable" is null) and ("radcore"."delivery_lines"."taxable" is null) = ("radcore"."delivery_lines"."gst" is null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."delivery_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"delivery_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"value" numeric(18, 2),
	"taxable" numeric(18, 2),
	"gst" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_delivery_return_lines_qty" CHECK ("radcore"."delivery_return_lines"."qty" > 0 and "radcore"."delivery_return_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_delivery_return_lines_value" CHECK ("radcore"."delivery_return_lines"."value" >= 0 and "radcore"."delivery_return_lines"."value" <> 'NaN'),
	CONSTRAINT "ck_delivery_return_lines_taxable" CHECK ("radcore"."delivery_return_lines"."taxable" >= 0 and "radcore"."delivery_return_lines"."taxable" <> 'NaN'),
	CONSTRAINT "ck_delivery_return_lines_gst" CHECK ("radcore"."delivery_return_lines"."gst" >= 0 and "radcore"."delivery_return_lines"."gst" <> 'NaN'),
	CONSTRAINT "ck_delivery_return_lines_posted" CHECK (("radcore"."delivery_return_lines"."value" is null) = ("radcore"."delivery_return_lines"."taxable" is null) and ("radcore"."delivery_return_lines"."taxable" is null) = ("radcore"."delivery_return_lines"."gst" is null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."delivery_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"delivery_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"notes" text,
	"owner" text NOT NULL,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "delivery_returns_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_delivery_returns_notes" CHECK (char_length("radcore"."delivery_returns"."notes") <= 500),
	CONSTRAINT "ck_delivery_returns_cancel_reason" CHECK (char_length("radcore"."delivery_returns"."cancel_reason") <= 500),
	CONSTRAINT "ck_delivery_returns_status" CHECK ("radcore"."delivery_returns"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_delivery_returns_posted" CHECK (("radcore"."delivery_returns"."status" = 'draft') = ("radcore"."delivery_returns"."number" is null) and ("radcore"."delivery_returns"."status" <> 'draft' or "radcore"."delivery_returns"."posted_entry_id" is null)),
	CONSTRAINT "ck_delivery_returns_cancelled" CHECK (("radcore"."delivery_returns"."status" = 'cancelled') = ("radcore"."delivery_returns"."cancel_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "deliveries_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "deliveries_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "deliveries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "deliveries_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."deliveries" ADD CONSTRAINT "deliveries_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "radcore"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_lines" ADD CONSTRAINT "delivery_lines_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "radcore"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_lines" ADD CONSTRAINT "delivery_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_return_lines" ADD CONSTRAINT "delivery_return_lines_return_id_delivery_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "radcore"."delivery_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_return_lines" ADD CONSTRAINT "delivery_return_lines_delivery_line_id_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "radcore"."delivery_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_return_lines" ADD CONSTRAINT "delivery_return_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_returns" ADD CONSTRAINT "delivery_returns_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "radcore"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_returns" ADD CONSTRAINT "delivery_returns_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_returns" ADD CONSTRAINT "delivery_returns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_returns" ADD CONSTRAINT "delivery_returns_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."delivery_returns" ADD CONSTRAINT "delivery_returns_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_deliveries_order" ON "radcore"."deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_deliveries_party_date" ON "radcore"."deliveries" USING btree ("party_id","business_date");--> statement-breakpoint
CREATE INDEX "ix_deliveries_location" ON "radcore"."deliveries" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_deliveries_posted_entry" ON "radcore"."deliveries" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_deliveries_cancel_entry" ON "radcore"."deliveries" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE INDEX "ix_deliveries_date" ON "radcore"."deliveries" USING btree ("business_date","id");--> statement-breakpoint
CREATE INDEX "ix_deliveries_owner" ON "radcore"."deliveries" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_delivery_lines_line" ON "radcore"."delivery_lines" USING btree ("delivery_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_delivery_lines_order_line" ON "radcore"."delivery_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_lines_item" ON "radcore"."delivery_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_delivery_return_lines_line" ON "radcore"."delivery_return_lines" USING btree ("return_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_delivery_return_lines_delivery_line" ON "radcore"."delivery_return_lines" USING btree ("delivery_line_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_return_lines_item" ON "radcore"."delivery_return_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_delivery" ON "radcore"."delivery_returns" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_party_date" ON "radcore"."delivery_returns" USING btree ("party_id","business_date");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_location" ON "radcore"."delivery_returns" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_posted_entry" ON "radcore"."delivery_returns" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_cancel_entry" ON "radcore"."delivery_returns" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_date" ON "radcore"."delivery_returns" USING btree ("business_date","id");--> statement-breakpoint
CREATE INDEX "ix_delivery_returns_owner" ON "radcore"."delivery_returns" USING btree ("owner");--> statement-breakpoint
-- Deliveries and delivery returns are posted documents (ADR-007 §1, §2; ADR-005 §7b): draft -> posted -> cancelled,
-- cancelled final. While a draft, anything changes; after posting, only the move to cancelled and its cancel columns
-- (M3-10, RAD-114), and the lines not at all.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('deliveries', 'draft', 'posted'), ('deliveries', 'posted', 'cancelled'),
  ('delivery_returns', 'draft', 'posted'), ('delivery_returns', 'posted', 'cancelled');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.deliveries
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.delivery_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('deliveries', 'delivery_id', 'draft');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.delivery_returns
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.delivery_return_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('delivery_returns', 'return_id', 'draft');
--> statement-breakpoint
-- Stock documents are audited in full: every column kept. A document's lines are its parts (ADR-001 §8b), so
-- maker-checker finds everyone who changed a delivery since its override was asked for (RC-037).
SELECT radcore.audit_attach('deliveries', keep => array['status', 'number', 'order_id', 'party_id', 'owner', 'location_id', 'business_date',
  'notes', 'override_version', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('delivery_lines', keep => array['delivery_id', 'line_no', 'order_line_id', 'item_id', 'qty', 'picks',
  'value', 'taxable', 'gst'], owner => 'delivery_id', owner_table => 'deliveries');
--> statement-breakpoint
SELECT radcore.audit_attach('delivery_returns', keep => array['status', 'number', 'delivery_id', 'party_id', 'owner', 'location_id',
  'business_date', 'notes', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('delivery_return_lines', keep => array['return_id', 'line_no', 'delivery_line_id', 'item_id', 'qty', 'picks',
  'value', 'taxable', 'gst'], owner => 'return_id', owner_table => 'delivery_returns');
--> statement-breakpoint
-- A posted document is never emptied: only a draft is deleted, row by row, and the guards refuse the rest.
REVOKE TRUNCATE ON radcore.deliveries, radcore.delivery_lines, radcore.delivery_returns, radcore.delivery_return_lines FROM radcore_app;
--> statement-breakpoint
-- deliveries:write (RAD-112), an ordinary catalogue key any role can be given (Sarthak: dynamic, by owner and admin). The
-- starting grants, in each role's template too (RAD-83): stores and the counter send goods out, and the owner. The
-- admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'deliveries:write', 'all' FROM unnest(array['admin', 'owner', 'stores', 'counter']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'deliveries:write', 'all' FROM unnest(array['admin', 'owner', 'stores', 'counter']) AS r
ON CONFLICT DO NOTHING;
