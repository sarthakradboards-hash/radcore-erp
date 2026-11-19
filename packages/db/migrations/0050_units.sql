-- Moved by hand from drizzle's place for it, below: the unit events' composite keys reference this key, so it
-- comes first (RAD-94). Regenerating keeps this move.
ALTER TABLE "radcore"."stock_movements" ADD CONSTRAINT "ux_stock_movements_id_direction" UNIQUE("id","direction");--> statement-breakpoint
CREATE TABLE "radcore"."unit_event_rules" (
	"kind" text NOT NULL,
	"from_ownership" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_unit_event_rules" PRIMARY KEY("kind","from_ownership")
);
--> statement-breakpoint
CREATE TABLE "radcore"."unit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid,
	"item_id" uuid NOT NULL,
	"serial_no" text NOT NULL,
	"kind" text NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fy_start" date GENERATED ALWAYS AS (make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)) STORED NOT NULL,
	"out_movement_id" uuid,
	"out_direction" text GENERATED ALWAYS AS ('out') STORED NOT NULL,
	"in_movement_id" uuid,
	"in_direction" text GENERATED ALWAYS AS ('in') STORED NOT NULL,
	"location_id" uuid,
	"condition" text,
	"promised_to" uuid,
	"sale_line_id" uuid,
	"batch_id" uuid,
	"chassis_no" text,
	"reason_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_unit_events_serial_no" CHECK (char_length("radcore"."unit_events"."serial_no") <= 60),
	CONSTRAINT "ck_unit_events_chassis_no" CHECK (char_length("radcore"."unit_events"."chassis_no") <= 40),
	CONSTRAINT "ck_unit_events_kind" CHECK ("radcore"."unit_events"."kind" in ('received', 'moved', 'reserved', 'released', 'delivered',
    'delivery_returned', 'returned', 'returned_to_supplier', 'sent_to_job_work', 'received_from_job_work',
    'condition_changed', 'chassis_recorded', 'taken_in', 'handed_back', 'scrapped')),
	CONSTRAINT "ck_unit_events_condition" CHECK ("radcore"."unit_events"."condition" is null or "radcore"."unit_events"."condition" in ('new', 'demo', 'used', 'damaged')),
	CONSTRAINT "ck_unit_events_source_table" CHECK ("radcore"."unit_events"."source_table" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_unit_events_serial" CHECK ("radcore"."unit_events"."serial_no" ~ '^[ -~]*[!-~][ -~]*$'),
	CONSTRAINT "ck_unit_events_movements" CHECK (case
    when "radcore"."unit_events"."kind" in ('moved', 'sent_to_job_work', 'received_from_job_work') then "radcore"."unit_events"."out_movement_id" is not null and "radcore"."unit_events"."in_movement_id" is not null
    when "radcore"."unit_events"."kind" in ('received', 'delivery_returned', 'returned') then "radcore"."unit_events"."out_movement_id" is null and "radcore"."unit_events"."in_movement_id" is not null
    when "radcore"."unit_events"."kind" in ('delivered', 'returned_to_supplier', 'scrapped') then "radcore"."unit_events"."out_movement_id" is not null and "radcore"."unit_events"."in_movement_id" is null
    else "radcore"."unit_events"."out_movement_id" is null and "radcore"."unit_events"."in_movement_id" is null end),
	CONSTRAINT "ck_unit_events_reason" CHECK ("radcore"."unit_events"."kind" <> 'chassis_recorded' or "radcore"."unit_events"."reason_id" is not null),
	CONSTRAINT "ck_unit_events_unit" CHECK ("radcore"."unit_events"."unit_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "radcore"."units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text NOT NULL,
	"serial_key" text GENERATED ALWAYS AS (upper(regexp_replace(serial_no, '[[:space:]]', '', 'g'))) STORED NOT NULL,
	"ownership" text NOT NULL,
	"condition" text NOT NULL,
	"promised_to" uuid,
	"location_id" uuid,
	"sale_line_id" uuid,
	"batch_id" uuid,
	"chassis_no" text,
	"chassis_key" text GENERATED ALWAYS AS (upper(regexp_replace(chassis_no, '[[:space:]-]', '', 'g'))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_units_item_serial" UNIQUE("item_id","serial_key"),
	CONSTRAINT "ux_units_id_item" UNIQUE("id","item_id"),
	CONSTRAINT "ck_units_serial_no" CHECK (char_length("radcore"."units"."serial_no") <= 60),
	CONSTRAINT "ck_units_chassis_no" CHECK (char_length("radcore"."units"."chassis_no") <= 40),
	CONSTRAINT "ck_units_serial" CHECK ("radcore"."units"."serial_no" ~ '^[ -~]*[!-~][ -~]*$'),
	CONSTRAINT "ck_units_ownership" CHECK ("radcore"."units"."ownership" in ('ours', 'customer', 'gone')),
	CONSTRAINT "ck_units_condition" CHECK ("radcore"."units"."condition" in ('new', 'demo', 'used', 'damaged')),
	CONSTRAINT "ck_units_where" CHECK (("radcore"."units"."ownership" <> 'ours' or "radcore"."units"."location_id" is not null)
    and ("radcore"."units"."ownership" <> 'gone' or "radcore"."units"."location_id" is null)),
	CONSTRAINT "ck_units_sale" CHECK ("radcore"."units"."sale_line_id" is null or "radcore"."units"."ownership" = 'customer'),
	CONSTRAINT "ck_units_promise" CHECK ("radcore"."units"."promised_to" is null or "radcore"."units"."ownership" = 'ours')
);
--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "unit_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "unit_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "fk_unit_events_unit" FOREIGN KEY ("unit_id","item_id") REFERENCES "radcore"."units"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "fk_unit_events_out" FOREIGN KEY ("out_movement_id","out_direction") REFERENCES "radcore"."stock_movements"("id","direction") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "fk_unit_events_in" FOREIGN KEY ("in_movement_id","in_direction") REFERENCES "radcore"."stock_movements"("id","direction") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "fk_unit_events_batch" FOREIGN KEY ("batch_id","item_id") REFERENCES "radcore"."batches"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."unit_events" ADD CONSTRAINT "fk_unit_events_fy_start" FOREIGN KEY ("fy_start") REFERENCES "radcore"."financial_years"("start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."units" ADD CONSTRAINT "units_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "radcore"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."units" ADD CONSTRAINT "units_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."units" ADD CONSTRAINT "fk_units_batch" FOREIGN KEY ("batch_id","item_id") REFERENCES "radcore"."batches"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_unit_events_unit" ON "radcore"."unit_events" USING btree ("unit_id","item_id");--> statement-breakpoint
CREATE INDEX "ix_unit_events_out" ON "radcore"."unit_events" USING btree ("out_movement_id","out_direction");--> statement-breakpoint
CREATE INDEX "ix_unit_events_in" ON "radcore"."unit_events" USING btree ("in_movement_id","in_direction");--> statement-breakpoint
CREATE INDEX "ix_unit_events_batch" ON "radcore"."unit_events" USING btree ("batch_id","item_id");--> statement-breakpoint
CREATE INDEX "ix_unit_events_location" ON "radcore"."unit_events" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ix_unit_events_fy_start" ON "radcore"."unit_events" USING btree ("fy_start");--> statement-breakpoint
CREATE INDEX "ix_unit_events_item" ON "radcore"."unit_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "ix_unit_events_source" ON "radcore"."unit_events" USING btree ("source_table","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_units_chassis" ON "radcore"."units" USING btree ("chassis_key");--> statement-breakpoint
CREATE INDEX "ix_units_batch" ON "radcore"."units" USING btree ("batch_id","item_id");--> statement-breakpoint
CREATE INDEX "ix_units_location" ON "radcore"."units" USING btree ("location_id");--> statement-breakpoint
--> statement-breakpoint
-- RAD-94 (ADR-006 §5, RC-026): only the units engine changes a unit, through unit_events and its trigger. The runtime
-- login reads units, and writes none of them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.units FROM radcore_app;
--> statement-breakpoint
-- UPDATE on `id` alone, as period_lock has it: the engine locks the units it names FOR UPDATE, in id order (ADR-006 §1),
-- and that needs an UPDATE grant. It can't change a unit: every unit is made by an event, whose key on (unit_id,
-- item_id) refuses a new id.
GRANT UPDATE (id) ON radcore.units TO radcore_app;
--> statement-breakpoint
-- Which unit events may start from which ownership ('none': no row yet), equal to lib-common's UNIT_EVENTS
-- (tools/units.test.ts checks). Read-only to the app.
INSERT INTO radcore.unit_event_rules (kind, from_ownership) VALUES
  ('received', 'none'), ('received', 'gone'), ('moved', 'ours'), ('reserved', 'ours'), ('released', 'ours'),
  ('delivered', 'ours'), ('delivery_returned', 'customer'), ('returned', 'customer'), ('returned_to_supplier', 'ours'),
  ('sent_to_job_work', 'ours'), ('received_from_job_work', 'ours'), ('condition_changed', 'ours'),
  ('condition_changed', 'customer'), ('chassis_recorded', 'ours'), ('taken_in', 'none'), ('taken_in', 'customer'),
  ('handed_back', 'customer'), ('scrapped', 'ours');
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.unit_event_rules FROM radcore_app;
--> statement-breakpoint
-- Unit events are append-only (ADR-005 §7): an update, delete or truncate raises RA001. The app login holds no UPDATE,
-- DELETE or TRUNCATE either.
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.unit_events FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.unit_events FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.unit_events FROM radcore_app;
--> statement-breakpoint
-- Applies each event to its unit (ADR-006 §5): dated after the period lock (RA003), allowed from the unit's ownership
-- (unit_event_rules), its out movement at the unit's old location and its in movement taking it to the new one, and
-- the chassis number a flagged item needs on receipt and on delivery. Anything else raises RA008. The unit row is found
-- by item and serial, locked, and written here; the event takes its id and the location the unit ends at.
CREATE FUNCTION radcore.apply_unit_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  u radcore.units%ROWTYPE;
  flagged boolean;
  serialised boolean;
  from_state text;
  m_item uuid;
  m_location uuid;
  m_kind text;
  dest uuid;
  locked date;
BEGIN
  NEW.posted_at := now();
  NEW.reason_id := nullif(current_setting('app.reason_id', true), '')::uuid;
  -- Nothing posts on or before the period lock (RA003), an event that moves no stock included (auditor-2 on #216).
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked THEN
    RAISE EXCEPTION 'the books are locked through %, so no unit changes on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  SELECT i.serialised, i.has_chassis INTO serialised, flagged FROM radcore.items i WHERE i.id = NEW.item_id;
  IF serialised IS NOT TRUE THEN
    RAISE EXCEPTION 'unit %: its item isn''t serialised', NEW.serial_no USING ERRCODE = 'RA008';
  END IF;
  SELECT * INTO u FROM radcore.units
    WHERE item_id = NEW.item_id AND serial_key = upper(regexp_replace(NEW.serial_no, '[[:space:]]', '', 'g')) FOR UPDATE;
  from_state := CASE WHEN FOUND THEN u.ownership ELSE 'none' END;
  IF NOT EXISTS (SELECT 1 FROM radcore.unit_event_rules r WHERE r.kind = NEW.kind AND r.from_ownership = from_state) THEN
    RAISE EXCEPTION 'unit %: % isn''t allowed while it''s %', NEW.serial_no, NEW.kind, from_state USING ERRCODE = 'RA008';
  END IF;
  dest := u.location_id;
  IF NEW.out_movement_id IS NOT NULL THEN
    SELECT m.item_id, m.location_id, l.kind INTO m_item, m_location, m_kind
      FROM radcore.stock_movements m JOIN radcore.locations l ON l.id = m.location_id WHERE m.id = NEW.out_movement_id;
    IF m_item <> NEW.item_id OR m_location IS DISTINCT FROM u.location_id THEN
      RAISE EXCEPTION 'unit %: its out movement isn''t from where it is', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF NEW.kind = 'received_from_job_work' AND m_kind <> 'job_work' THEN
      RAISE EXCEPTION 'unit %: it comes back from a job worker''s location', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    dest := NULL;
  END IF;
  IF NEW.in_movement_id IS NOT NULL THEN
    SELECT m.item_id, m.location_id, l.kind INTO m_item, m_location, m_kind
      FROM radcore.stock_movements m JOIN radcore.locations l ON l.id = m.location_id WHERE m.id = NEW.in_movement_id;
    IF m_item <> NEW.item_id THEN
      RAISE EXCEPTION 'unit %: its in movement is another item''s', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF NEW.kind = 'sent_to_job_work' AND m_kind <> 'job_work' THEN
      RAISE EXCEPTION 'unit %: it goes to a job worker''s location', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    dest := m_location;
  END IF;

  IF NEW.kind = 'received' THEN
    -- Its batch is one of its movement's (§4a), and a flagged item's vehicle comes with its chassis number.
    IF NOT EXISTS (SELECT 1 FROM radcore.stock_movement_batches b
                   WHERE b.movement_id = NEW.in_movement_id AND b.batch_id IS NOT DISTINCT FROM NEW.batch_id) THEN
      RAISE EXCEPTION 'unit %: its batch isn''t one its receipt brought in', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF flagged AND NEW.chassis_no IS NULL THEN
      RAISE EXCEPTION 'unit %: its item has a chassis number, so it''s received with one', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF from_state = 'none' THEN
      INSERT INTO radcore.units (item_id, serial_no, ownership, condition, location_id, batch_id, chassis_no)
        VALUES (NEW.item_id, NEW.serial_no, 'ours', coalesce(NEW.condition, 'new'), dest, NEW.batch_id, NEW.chassis_no)
        RETURNING * INTO u;
    ELSE
      UPDATE radcore.units SET ownership = 'ours', condition = coalesce(NEW.condition, 'new'), location_id = dest,
        batch_id = NEW.batch_id, chassis_no = coalesce(NEW.chassis_no, chassis_no), sale_line_id = NULL
        WHERE id = u.id RETURNING * INTO u;
    END IF;
  ELSIF NEW.kind = 'taken_in' THEN
    -- A customer's vehicle in for service: not our stock, so no movement and no batch; its chassis number is optional.
    IF NEW.location_id IS NULL OR (from_state = 'customer' AND u.location_id IS NOT NULL) THEN
      RAISE EXCEPTION 'unit %: it''s taken in to a location, once', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    dest := NEW.location_id;
    IF from_state = 'none' THEN
      INSERT INTO radcore.units (item_id, serial_no, ownership, condition, location_id, chassis_no)
        VALUES (NEW.item_id, NEW.serial_no, 'customer', coalesce(NEW.condition, 'used'), dest, NEW.chassis_no)
        RETURNING * INTO u;
    ELSE
      UPDATE radcore.units SET location_id = dest, condition = coalesce(NEW.condition, condition),
        chassis_no = coalesce(NEW.chassis_no, chassis_no) WHERE id = u.id RETURNING * INTO u;
    END IF;
  ELSIF NEW.kind = 'handed_back' THEN
    IF u.location_id IS NULL THEN
      RAISE EXCEPTION 'unit %: it isn''t here to hand back', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    dest := NULL;
    UPDATE radcore.units SET location_id = NULL WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind IN ('moved', 'sent_to_job_work', 'received_from_job_work') THEN
    UPDATE radcore.units SET location_id = dest, condition = coalesce(NEW.condition, condition) WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind = 'reserved' THEN
    IF NEW.promised_to IS NULL OR u.promised_to IS NOT NULL THEN
      RAISE EXCEPTION 'unit %: it''s promised once, to one order line', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET promised_to = NEW.promised_to WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind = 'released' THEN
    IF u.promised_to IS NULL THEN
      RAISE EXCEPTION 'unit %: it isn''t promised', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET promised_to = NULL WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind = 'delivered' THEN
    -- Not promised to another order line, on its delivery line, and with its chassis number if its item has the flag.
    IF u.promised_to IS NOT NULL AND u.promised_to IS DISTINCT FROM NEW.promised_to THEN
      RAISE EXCEPTION 'unit %: it''s promised to another order', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF NEW.sale_line_id IS NULL THEN
      RAISE EXCEPTION 'unit %: a delivery names its line', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    IF flagged AND u.chassis_no IS NULL THEN
      RAISE EXCEPTION 'unit %: its item has a chassis number, so it leaves with one', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET ownership = 'customer', location_id = NULL, sale_line_id = NEW.sale_line_id, promised_to = NULL
      WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind IN ('delivery_returned', 'returned') THEN
    -- Back from a sale of ours: the sale is cleared (RC-128), which ends the warranty that came from it.
    IF u.sale_line_id IS NULL OR u.location_id IS NOT NULL THEN
      RAISE EXCEPTION 'unit %: only a unit we sold comes back', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET ownership = 'ours', location_id = dest, sale_line_id = NULL, condition = coalesce(NEW.condition, condition)
      WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind IN ('returned_to_supplier', 'scrapped') THEN
    IF u.promised_to IS NOT NULL THEN
      RAISE EXCEPTION 'unit %: it''s promised to an order', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET ownership = 'gone', location_id = NULL WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind = 'condition_changed' THEN
    IF NEW.condition IS NULL THEN
      RAISE EXCEPTION 'unit %: a condition change names the condition', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET condition = NEW.condition WHERE id = u.id RETURNING * INTO u;
  ELSIF NEW.kind = 'chassis_recorded' THEN
    IF NEW.chassis_no IS NULL THEN
      RAISE EXCEPTION 'unit %: recording a chassis number names it', NEW.serial_no USING ERRCODE = 'RA008';
    END IF;
    UPDATE radcore.units SET chassis_no = NEW.chassis_no WHERE id = u.id RETURNING * INTO u;
  END IF;
  NEW.unit_id := u.id;
  NEW.location_id := dest;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER apply_unit_event BEFORE INSERT ON radcore.unit_events FOR EACH ROW EXECUTE FUNCTION radcore.apply_unit_event();
--> statement-breakpoint
-- An event names its movements' document, which is then checked at commit like any other (ADR-005 §2): so events can't
-- be added later to a movement already complete.
CREATE FUNCTION radcore.note_unit_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT DISTINCT m.source_table, m.source_id FROM new_rows n
      JOIN radcore.stock_movements m ON m.id = n.out_movement_id OR m.id = n.in_movement_id
    ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_document AFTER INSERT ON radcore.unit_events REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_unit_documents();
--> statement-breakpoint
-- A document's checks at commit (the architect on RAD-93): its stock and books agree (RAD-93), then its units agree with
-- its stock (§5, RA007). Each in and out movement of a serialised item has as many events naming it as its quantity,
-- and, per batch, as many units of that batch as its batch row (§4a).
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
END $$;
--> statement-breakpoint
-- Turning an item's chassis flag off is refused while any unit of it has a number (§5, RA008): the item service says
-- so first (chassis_numbers_recorded).
CREATE FUNCTION radcore.guard_item_chassis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF OLD.has_chassis AND NOT NEW.has_chassis
     AND EXISTS (SELECT 1 FROM radcore.units u WHERE u.item_id = NEW.id AND u.chassis_no IS NOT NULL) THEN
    RAISE EXCEPTION 'item %: its units have chassis numbers, so it keeps the flag', NEW.sku USING ERRCODE = 'RA008';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_item_chassis BEFORE UPDATE OF has_chassis ON radcore.items FOR EACH ROW EXECUTE FUNCTION radcore.guard_item_chassis();
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c). Units keep every column, so a chassis number's old and new value are both
-- in its audit rows; unit_events is a ledger, audited in full; the rules are seed data.
SELECT radcore.audit_attach('units', keep => array['item_id', 'serial_no', 'serial_key', 'ownership', 'condition',
  'promised_to', 'location_id', 'sale_line_id', 'batch_id', 'chassis_no', 'chassis_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('unit_events', keep => array['unit_id', 'item_id', 'serial_no', 'kind', 'source_table',
  'source_id', 'business_date', 'posted_at', 'fy_start', 'out_movement_id', 'out_direction', 'in_movement_id',
  'in_direction', 'location_id', 'condition', 'promised_to', 'sale_line_id', 'batch_id', 'chassis_no', 'reason_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('unit_event_rules', keep => array['kind', 'from_ownership']);
