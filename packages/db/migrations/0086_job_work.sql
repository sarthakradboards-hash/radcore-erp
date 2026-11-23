CREATE TABLE "radcore"."job_work_challan_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"picks" jsonb NOT NULL,
	"value" numeric(18, 2),
	CONSTRAINT "ck_job_work_challan_lines_qty" CHECK ("radcore"."job_work_challan_lines"."qty" > 0 and "radcore"."job_work_challan_lines"."qty" <> 'NaN'),
	CONSTRAINT "ck_job_work_challan_lines_value" CHECK ("radcore"."job_work_challan_lines"."value" >= 0 and "radcore"."job_work_challan_lines"."value" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."job_work_challans" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"notes" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "job_work_challans_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_job_work_challans_notes" CHECK (char_length("radcore"."job_work_challans"."notes") <= 500),
	CONSTRAINT "ck_job_work_challans_cancel_reason" CHECK (char_length("radcore"."job_work_challans"."cancel_reason") <= 500),
	CONSTRAINT "ck_job_work_challans_status" CHECK ("radcore"."job_work_challans"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_job_work_challans_places" CHECK ("radcore"."job_work_challans"."from_id" <> "radcore"."job_work_challans"."to_id"),
	CONSTRAINT "ck_job_work_challans_posted" CHECK (("radcore"."job_work_challans"."status" = 'draft') = ("radcore"."job_work_challans"."number" is null) and ("radcore"."job_work_challans"."status" <> 'draft' or "radcore"."job_work_challans"."posted_entry_id" is null)),
	CONSTRAINT "ck_job_work_challans_cancelled" CHECK (("radcore"."job_work_challans"."status" = 'cancelled') = ("radcore"."job_work_challans"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."job_work_receipt_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"challan_line_id" uuid NOT NULL,
	"made_item_id" uuid,
	"made_qty" numeric(18, 3),
	"charge_rate" numeric(18, 6),
	"made_serials" jsonb,
	"used" numeric(18, 3) NOT NULL,
	"used_picks" jsonb NOT NULL,
	"back" numeric(18, 3) NOT NULL,
	"back_picks" jsonb NOT NULL,
	"lost" numeric(18, 3) NOT NULL,
	"lost_picks" jsonb NOT NULL,
	"used_value" numeric(18, 2),
	"charge" numeric(18, 2),
	"lost_value" numeric(18, 2),
	CONSTRAINT "ck_job_work_receipt_lines_made_qty" CHECK ("radcore"."job_work_receipt_lines"."made_qty" > 0 and "radcore"."job_work_receipt_lines"."made_qty" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_charge_rate" CHECK ("radcore"."job_work_receipt_lines"."charge_rate" >= 0 and "radcore"."job_work_receipt_lines"."charge_rate" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_used" CHECK ("radcore"."job_work_receipt_lines"."used" >= 0 and "radcore"."job_work_receipt_lines"."used" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_back" CHECK ("radcore"."job_work_receipt_lines"."back" >= 0 and "radcore"."job_work_receipt_lines"."back" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_lost" CHECK ("radcore"."job_work_receipt_lines"."lost" >= 0 and "radcore"."job_work_receipt_lines"."lost" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_used_value" CHECK ("radcore"."job_work_receipt_lines"."used_value" >= 0 and "radcore"."job_work_receipt_lines"."used_value" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_charge" CHECK ("radcore"."job_work_receipt_lines"."charge" >= 0 and "radcore"."job_work_receipt_lines"."charge" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_lost_value" CHECK ("radcore"."job_work_receipt_lines"."lost_value" >= 0 and "radcore"."job_work_receipt_lines"."lost_value" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipt_lines_made" CHECK (("radcore"."job_work_receipt_lines"."made_item_id" is null) = ("radcore"."job_work_receipt_lines"."made_qty" is null) and ("radcore"."job_work_receipt_lines"."made_item_id" is null) = ("radcore"."job_work_receipt_lines"."charge_rate" is null)),
	CONSTRAINT "ck_job_work_receipt_lines_parts" CHECK ("radcore"."job_work_receipt_lines"."used" >= 0 and "radcore"."job_work_receipt_lines"."back" >= 0 and "radcore"."job_work_receipt_lines"."lost" >= 0 and "radcore"."job_work_receipt_lines"."used" + "radcore"."job_work_receipt_lines"."back" + "radcore"."job_work_receipt_lines"."lost" > 0)
);
--> statement-breakpoint
CREATE TABLE "radcore"."job_work_receipts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"charges" numeric(18, 2),
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"notes" text,
	"posted_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	CONSTRAINT "job_work_receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "ck_job_work_receipts_charges" CHECK ("radcore"."job_work_receipts"."charges" >= 0 and "radcore"."job_work_receipts"."charges" <> 'NaN'),
	CONSTRAINT "ck_job_work_receipts_notes" CHECK (char_length("radcore"."job_work_receipts"."notes") <= 500),
	CONSTRAINT "ck_job_work_receipts_cancel_reason" CHECK (char_length("radcore"."job_work_receipts"."cancel_reason") <= 500),
	CONSTRAINT "ck_job_work_receipts_status" CHECK ("radcore"."job_work_receipts"."status" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "ck_job_work_receipts_posted" CHECK (("radcore"."job_work_receipts"."status" = 'draft') = ("radcore"."job_work_receipts"."number" is null) and ("radcore"."job_work_receipts"."status" <> 'draft' or "radcore"."job_work_receipts"."posted_entry_id" is null)),
	CONSTRAINT "ck_job_work_receipts_cancelled" CHECK (("radcore"."job_work_receipts"."status" = 'cancelled') = ("radcore"."job_work_receipts"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."locations" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_challan_id_job_work_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "radcore"."job_work_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challans" ADD CONSTRAINT "job_work_challans_from_id_locations_id_fk" FOREIGN KEY ("from_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challans" ADD CONSTRAINT "job_work_challans_to_id_locations_id_fk" FOREIGN KEY ("to_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challans" ADD CONSTRAINT "job_work_challans_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challans" ADD CONSTRAINT "job_work_challans_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_challans" ADD CONSTRAINT "job_work_challans_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_receipt_id_job_work_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "radcore"."job_work_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_made_item_id_items_id_fk" FOREIGN KEY ("made_item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipt_lines" ADD CONSTRAINT "fk_job_work_receipt_lines_challan_line" FOREIGN KEY ("challan_line_id") REFERENCES "radcore"."job_work_challan_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipts" ADD CONSTRAINT "job_work_receipts_challan_id_job_work_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "radcore"."job_work_challans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipts" ADD CONSTRAINT "job_work_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipts" ADD CONSTRAINT "job_work_receipts_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."job_work_receipts" ADD CONSTRAINT "job_work_receipts_cancel_entry_id_journal_entries_id_fk" FOREIGN KEY ("cancel_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_job_work_challan_lines_line" ON "radcore"."job_work_challan_lines" USING btree ("challan_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_job_work_challan_lines_item" ON "radcore"."job_work_challan_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_date" ON "radcore"."job_work_challans" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_party" ON "radcore"."job_work_challans" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_from" ON "radcore"."job_work_challans" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_to" ON "radcore"."job_work_challans" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_created_by" ON "radcore"."job_work_challans" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_posted_entry" ON "radcore"."job_work_challans" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_challans_cancel_entry" ON "radcore"."job_work_challans" USING btree ("cancel_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_job_work_receipt_lines_line" ON "radcore"."job_work_receipt_lines" USING btree ("receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipt_lines_challan_line" ON "radcore"."job_work_receipt_lines" USING btree ("challan_line_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipt_lines_made_item" ON "radcore"."job_work_receipt_lines" USING btree ("made_item_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_date" ON "radcore"."job_work_receipts" USING btree ("business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_challan" ON "radcore"."job_work_receipts" USING btree ("challan_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_location" ON "radcore"."job_work_receipts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_created_by" ON "radcore"."job_work_receipts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_posted_entry" ON "radcore"."job_work_receipts" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_job_work_receipts_cancel_entry" ON "radcore"."job_work_receipts" USING btree ("cancel_entry_id");--> statement-breakpoint
ALTER TABLE "radcore"."locations" ADD CONSTRAINT "locations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_locations_party" ON "radcore"."locations" USING btree ("party_id");--> statement-breakpoint
ALTER TABLE "radcore"."locations" ADD CONSTRAINT "ck_locations_job_worker" CHECK (("radcore"."locations"."kind" = 'job_work') = ("radcore"."locations"."party_id" is not null));--> statement-breakpoint
-- RAD-142 (M4-07; ADR-008 §1, §2, §11, §13): job work challans and receipts. Posted documents (ADR-005 §7b): inserted as
-- a draft, given their lines and posted in one save; after that only the move to cancelled and its cancel columns,
-- and the lines not at all.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('job_work_challans', 'draft', 'posted'), ('job_work_challans', 'posted', 'cancelled'),
  ('job_work_receipts', 'draft', 'posted'), ('job_work_receipts', 'posted', 'cancelled');
--> statement-breakpoint
-- A posted challan's receipts close and reopen it (`closed`), so the guard lets that column change too.
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.job_work_challans
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id,closed', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.job_work_challan_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('job_work_challans', 'challan_id', 'draft');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.job_work_receipts
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.job_work_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('job_work_receipts', 'receipt_id', 'draft');
--> statement-breakpoint
-- Audited in full; the lines are their documents' parts (ADR-001 §8b).
SELECT radcore.audit_attach('job_work_challans', keep => array['status', 'number', 'from_id', 'to_id', 'party_id', 'closed', 'business_date', 'notes',
  'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('job_work_challan_lines', keep => array['challan_id', 'line_no', 'item_id', 'qty', 'picks', 'value'],
  owner => 'challan_id', owner_table => 'job_work_challans');
--> statement-breakpoint
SELECT radcore.audit_attach('job_work_receipts', keep => array['status', 'number', 'challan_id', 'location_id', 'charges', 'business_date',
  'notes', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('job_work_receipt_lines', keep => array['receipt_id', 'line_no', 'challan_line_id', 'made_item_id', 'made_qty',
  'charge_rate', 'made_serials', 'used', 'used_picks', 'back', 'back_picks', 'lost', 'lost_picks', 'used_value', 'charge', 'lost_value'],
  owner => 'receipt_id', owner_table => 'job_work_receipts');
--> statement-breakpoint
REVOKE TRUNCATE ON radcore.job_work_challans, radcore.job_work_challan_lines, radcore.job_work_receipts, radcore.job_work_receipt_lines
  FROM radcore_app;
--> statement-breakpoint
-- job_work:write (ADR-008 §13): an ordinary catalogue key, no second factor (D-19), not all-only. Its starting grants,
-- in each role's template too (RAD-83): the admin, the stores and operations.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'job_work:write', 'all' FROM unnest(array['admin', 'stores', 'operations']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'job_work:write', 'all' FROM unnest(array['admin', 'stores', 'operations']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- locations gains party_id (a job worker's own place, §11): attached again, so its trail keeps it (ADR-005 §5).
SELECT radcore.audit_attach('locations', keep => array['code', 'name', 'kind', 'active', 'code_key', 'party_id']);
