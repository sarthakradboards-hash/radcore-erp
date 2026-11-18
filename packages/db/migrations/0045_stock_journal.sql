ALTER TABLE "radcore"."stock_movements" ADD COLUMN "fy_start" date GENERATED ALWAYS AS (make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."stock_movements" ADD CONSTRAINT "fk_stock_movements_fy_start" FOREIGN KEY ("fy_start") REFERENCES "radcore"."financial_years"("start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_stock_movements_fy_start" ON "radcore"."stock_movements" USING btree ("fy_start");--> statement-breakpoint
-- stock_movements gains fy_start (ADR-005 §6), so it's attached again with it kept: a ledger keeps every column.
SELECT radcore.audit_attach('stock_movements', keep => array['item_id', 'location_id', 'source_table', 'source_id',
  'source_line_id', 'direction', 'qty', 'value', 'rate', 'business_date', 'posted_at', 'fy_start', 'reverses_movement_id']);
--> statement-breakpoint
-- A movement on or before the period lock is refused (RA003, ADR-006 §4), as a journal entry is: a movement of value 0,
-- such as a free receipt, has no Stock in Hand line, so the journal's own check would never see its date.
CREATE FUNCTION radcore.guard_stock_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  locked date;
BEGIN
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked THEN
    RAISE EXCEPTION 'the books are locked through %, so no stock moves on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_stock_movement BEFORE INSERT ON radcore.stock_movements FOR EACH ROW EXECUTE FUNCTION radcore.guard_stock_movement();
