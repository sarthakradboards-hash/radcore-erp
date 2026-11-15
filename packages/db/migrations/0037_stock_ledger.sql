CREATE TABLE "radcore"."batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_id" uuid,
	"batch_no" text NOT NULL,
	"batch_key" text GENERATED ALWAYS AS (upper(regexp_replace(batch_no, '[[:space:]-]', '', 'g'))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_batches_item_supplier_key" UNIQUE NULLS NOT DISTINCT("item_id","supplier_id","batch_key"),
	CONSTRAINT "ux_batches_id_item" UNIQUE("id","item_id"),
	CONSTRAINT "ck_batches_batch_no" CHECK (char_length("radcore"."batches"."batch_no") <= 40),
	CONSTRAINT "ck_batches_supplier" CHECK ("radcore"."batches"."supplier_id" is null)
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_movement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(18, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_stock_movement_batches_movement_batch" UNIQUE NULLS NOT DISTINCT("movement_id","batch_id"),
	CONSTRAINT "ck_stock_movement_batches_qty" CHECK ("radcore"."stock_movement_batches"."qty" > 0 and "radcore"."stock_movement_batches"."qty" <> 'NaN')
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_line_id" uuid,
	"direction" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"rate" numeric(18, 6),
	"business_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_stock_movements_id_item" UNIQUE("id","item_id"),
	CONSTRAINT "ck_stock_movements_qty" CHECK ("radcore"."stock_movements"."qty" >= 0 and "radcore"."stock_movements"."qty" <> 'NaN'),
	CONSTRAINT "ck_stock_movements_value" CHECK ("radcore"."stock_movements"."value" <> 'NaN'),
	CONSTRAINT "ck_stock_movements_rate" CHECK ("radcore"."stock_movements"."rate" >= 0 and "radcore"."stock_movements"."rate" <> 'NaN'),
	CONSTRAINT "ck_stock_movements_direction" CHECK ("radcore"."stock_movements"."direction" in ('in', 'out', 'revalue')),
	CONSTRAINT "ck_stock_movements_revalue_qty" CHECK (("radcore"."stock_movements"."direction" = 'revalue') = ("radcore"."stock_movements"."qty" = 0)),
	CONSTRAINT "ck_stock_movements_value_sign" CHECK ("radcore"."stock_movements"."direction" = 'revalue' or "radcore"."stock_movements"."value" >= 0),
	CONSTRAINT "ck_stock_movements_rate_in" CHECK ("radcore"."stock_movements"."rate" is null or "radcore"."stock_movements"."direction" = 'in'),
	CONSTRAINT "ck_stock_movements_source_table" CHECK ("radcore"."stock_movements"."source_table" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."stock_positions" (
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_stock_positions" PRIMARY KEY("item_id","location_id")
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
ALTER TABLE "radcore"."batches" ADD CONSTRAINT "batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movement_batches" ADD CONSTRAINT "fk_stock_movement_batches_movement" FOREIGN KEY ("movement_id","item_id") REFERENCES "radcore"."stock_movements"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movement_batches" ADD CONSTRAINT "fk_stock_movement_batches_batch" FOREIGN KEY ("batch_id","item_id") REFERENCES "radcore"."batches"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movements" ADD CONSTRAINT "fk_stock_movements_reverses" FOREIGN KEY ("reverses_movement_id") REFERENCES "radcore"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_positions" ADD CONSTRAINT "stock_positions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."stock_positions" ADD CONSTRAINT "stock_positions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_stock_movement_batches_movement_item" ON "radcore"."stock_movement_batches" USING btree ("movement_id","item_id");--> statement-breakpoint
CREATE INDEX "ix_stock_movement_batches_batch" ON "radcore"."stock_movement_batches" USING btree ("batch_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stock_movements_reverses" ON "radcore"."stock_movements" USING btree ("reverses_movement_id");--> statement-breakpoint
CREATE INDEX "ix_stock_movements_item_location" ON "radcore"."stock_movements" USING btree ("item_id","location_id");--> statement-breakpoint
CREATE INDEX "ix_stock_movements_location" ON "radcore"."stock_movements" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_stock_movements_source" ON "radcore"."stock_movements" USING btree ("source_table","source_id");--> statement-breakpoint
CREATE INDEX "ix_stock_positions_location" ON "radcore"."stock_positions" USING btree ("location_id");--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions',
        'change_reasons', 'user_sign_ins', 'stock_positions'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- The stock ledger is append-only (ADR-005 §7, RAD-93): an update, delete or truncate raises RA001. A correction is a
-- new mirror-image row, never an edit.
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.stock_movements FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.stock_movements FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.batches FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.batches FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.stock_movement_batches FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.stock_movement_batches FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
-- And by grants (ADR-005 §7): the app's login may only add rows.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.stock_movements, radcore.batches, radcore.stock_movement_batches FROM radcore_app;
--> statement-breakpoint
-- Append-only ledgers are audited in full, every column kept (ADR-005 §7c): the audit row records the login and client
-- address that wrote each row, which the row itself doesn't.
SELECT radcore.audit_attach('stock_movements', keep => array['item_id', 'location_id', 'source_table', 'source_id',
  'source_line_id', 'direction', 'qty', 'value', 'rate', 'business_date', 'posted_at', 'reverses_movement_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('batches', keep => array['item_id', 'supplier_id', 'batch_no', 'batch_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('stock_movement_batches', keep => array['movement_id', 'item_id', 'batch_id', 'qty']);
--> statement-breakpoint
-- The lock rows (ADR-006 §1) hold only the key they're locked by, so they're machinery (ADR-005 §7c, the architect on
-- RAD-93): stamped who-and-when, not row-audited. They're never removed: the app's login can't delete them.
SELECT radcore.audit_attach('stock_positions', capture => false);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.stock_positions FROM radcore_app;
