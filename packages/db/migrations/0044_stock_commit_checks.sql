ALTER TABLE "radcore"."batches" DROP CONSTRAINT "ck_batches_supplier";--> statement-breakpoint
ALTER TABLE "radcore"."batches" ADD CONSTRAINT "batches_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_batches_supplier" ON "radcore"."batches" USING btree ("supplier_id");--> statement-breakpoint
CREATE VIEW "radcore"."v_batch_on_hand" AS (select m.item_id, m.location_id, b.batch_id,
    sum(case m.direction when 'in' then b.qty else -b.qty end) as qty
  from radcore.stock_movement_batches b
  join radcore.stock_movements m on m.id = b.movement_id and m.item_id = b.item_id
  group by m.item_id, m.location_id, b.batch_id);--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "radcore"."v_batch_on_hand" FROM radcore_app;
--> statement-breakpoint
-- ADR-006 §4 and §4a, checked at commit (RA007, RAD-93), for each movement a save wrote or gave batch rows to:
-- - an `in` or `out` movement's batch rows add up to its quantity, and a `revalue` has none;
-- - its item's position at its location holds no value at zero units, and is below zero only in negative-stock mode,
--   on no day from the movement's business date onward either (§4's back-dated issue);
-- - no batch it names is below zero there, and "batch unknown" (a null batch) is never above zero, and below zero
--   only in negative-stock mode.
-- Negative-stock mode is lib-stock's `stock.negative_stock` setting, read here so no path can disagree with the engine.
-- Deferred, so a save's movements and batch rows are all in before it runs. The position lock (ADR-006 §1) means no
-- other save changes these sums before this one commits.
CREATE FUNCTION radcore.stock_commit_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  movement_id uuid := coalesce(to_jsonb(NEW) ->> 'movement_id', to_jsonb(NEW) ->> 'id')::uuid;
  m radcore.stock_movements%ROWTYPE;
  negative boolean := coalesce((SELECT s.value = 'true'::jsonb FROM radcore.settings s WHERE s.key = 'stock.negative_stock'), false);
  named numeric;
  named_rows bigint;
  on_qty numeric;
  on_value numeric;
  bad record;
BEGIN
  SELECT * INTO m FROM radcore.stock_movements WHERE id = movement_id;
  SELECT coalesce(sum(b.qty), 0), count(*) INTO named, named_rows
    FROM radcore.stock_movement_batches b WHERE b.movement_id = m.id;
  IF (m.direction = 'revalue' AND named_rows > 0) OR (m.direction <> 'revalue' AND named <> m.qty) THEN
    RAISE EXCEPTION 'stock movement %: its batches hold % of %', m.id, named, m.qty USING ERRCODE = 'RA007';
  END IF;
  SELECT coalesce(sum(CASE x.direction WHEN 'in' THEN x.qty WHEN 'out' THEN -x.qty ELSE 0 END), 0),
         coalesce(sum(CASE x.direction WHEN 'out' THEN -x.value ELSE x.value END), 0)
    INTO on_qty, on_value
    FROM radcore.stock_movements x WHERE x.item_id = m.item_id AND x.location_id = m.location_id;
  IF on_qty = 0 AND on_value <> 0 THEN
    RAISE EXCEPTION 'item % at location % holds % with no units', m.item_id, m.location_id, on_value USING ERRCODE = 'RA007';
  END IF;
  IF on_qty < 0 AND NOT negative THEN
    RAISE EXCEPTION 'item % at location % would go below zero', m.item_id, m.location_id USING ERRCODE = 'RA007';
  END IF;
  -- §4: with negative stock off, no day from this movement's business date onward is below zero, so a back-dated issue
  -- can't make a later day negative.
  IF NOT negative AND EXISTS (SELECT 1 FROM (
      SELECT x.business_date, sum(sum(CASE x.direction WHEN 'in' THEN x.qty WHEN 'out' THEN -x.qty ELSE 0 END))
        OVER (ORDER BY x.business_date) AS level
      FROM radcore.stock_movements x WHERE x.item_id = m.item_id AND x.location_id = m.location_id
      GROUP BY x.business_date) d
    WHERE d.business_date >= m.business_date AND d.level < 0) THEN
    RAISE EXCEPTION 'item % at location % would go below zero on a day from %', m.item_id, m.location_id, m.business_date
      USING ERRCODE = 'RA007';
  END IF;
  SELECT b.batch_id, sum(CASE x.direction WHEN 'in' THEN b.qty ELSE -b.qty END) AS qty INTO bad
    FROM radcore.stock_movement_batches b
    JOIN radcore.stock_movements x ON x.id = b.movement_id AND x.item_id = b.item_id
    WHERE x.item_id = m.item_id AND x.location_id = m.location_id
      AND EXISTS (SELECT 1 FROM radcore.stock_movement_batches t WHERE t.movement_id = m.id AND t.batch_id IS NOT DISTINCT FROM b.batch_id)
    GROUP BY b.batch_id
    HAVING (b.batch_id IS NOT NULL AND sum(CASE x.direction WHEN 'in' THEN b.qty ELSE -b.qty END) < 0)
        OR (b.batch_id IS NULL AND (sum(CASE x.direction WHEN 'in' THEN b.qty ELSE -b.qty END) > 0
          OR (sum(CASE x.direction WHEN 'in' THEN b.qty ELSE -b.qty END) < 0 AND NOT negative)))
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'item % at location %: batch % would hold %', m.item_id, m.location_id,
      coalesce(bad.batch_id::text, 'unknown'), bad.qty USING ERRCODE = 'RA007';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_commit_check AFTER INSERT ON radcore.stock_movements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION radcore.stock_commit_check();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_commit_check AFTER INSERT ON radcore.stock_movement_batches DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION radcore.stock_commit_check();
