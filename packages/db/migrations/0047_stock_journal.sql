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
--> statement-breakpoint
-- A document's own checks at commit (ADR-006 §4, the architect on RAD-93), through pending_document_checks (ADR-005
-- §2): the first is that its stock and its books agree. Per item and location, the net value of its movements (in
-- minus out, plus revalue) equals the net Stock in Hand of all its entries' lines, so a line with no movement fails,
-- and so does a movement with value and no line (RA007). §4a's batch sums and §5's unit counts join it as they land.
CREATE FUNCTION radcore.check_document(doc_table text, doc_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
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
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_document(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- #203's dispatch, its journal branch as it was; any other row is a document, checked by check_document.
CREATE OR REPLACE FUNCTION radcore.check_pending_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.table_name = 'journal_entries' THEN
    PERFORM radcore.check_journal_entry(NEW.document_id);
  ELSE
    PERFORM radcore.check_document(NEW.table_name, NEW.document_id);
  END IF;
  DELETE FROM radcore.pending_document_checks WHERE table_name = NEW.table_name AND document_id = NEW.document_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Each document a statement touched is noted once, by its own table and id: its movements, and its entries' Stock in
-- Hand lines (so books with no movement are checked too). The journal's own note for RA002 is unchanged.
CREATE FUNCTION radcore.note_stock_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT DISTINCT n.source_table, n.source_id FROM new_rows n ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_document AFTER INSERT ON radcore.stock_movements REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_stock_documents();
--> statement-breakpoint
CREATE FUNCTION radcore.note_stock_line_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT DISTINCT e.source_table, e.source_id FROM new_rows n JOIN radcore.journal_entries e ON e.id = n.entry_id
    WHERE n.account_control_kind = 'stock' ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_document AFTER INSERT ON radcore.journal_lines REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_stock_line_documents();
