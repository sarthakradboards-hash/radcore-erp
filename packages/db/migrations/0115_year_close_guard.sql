-- RAD-157 (ADR-009 §6; auditor-2 on #426): the period lock lets a year_close entry through only when it names a close of
-- its own year, dated that year's 31 March. Before, any entry of kind year_close dated a 31 March passed, so a call
-- to postEntry or reverseEntry from any library could post into a locked year.
CREATE OR REPLACE FUNCTION radcore.guard_journal_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  locked date;
BEGIN
  NEW.posted_at := now();
  NEW.tx_id := pg_current_xact_id()::text::bigint;
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked
     AND NOT (NEW.kind = 'year_close' AND NEW.source_table = 'year_closes' AND EXISTS (
       SELECT 1 FROM radcore.year_closes c
       WHERE c.id = NEW.source_id AND NEW.business_date = (c.fy_start + interval '1 year' - interval '1 day')::date)) THEN
    RAISE EXCEPTION 'the books are locked through %, so nothing posts on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  RETURN NEW;
END $$;
