-- RAD-152 (the architect's ruling (a), 27 Nov): POST /accounts adds ordinary accounts. drizzle's insert names every
-- column, so the column grants of 0041 (name, type, parent_id) and 0049 (code) can't take it. The app may insert into
-- the whole table; a trigger keeps what the grant kept: only the owner (migrations) adds a system key or a control
-- account (ADR-006 §2). UPDATE stays column-granted.
CREATE FUNCTION radcore.keep_ordinary_account_insert() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF (NEW.system_key IS NOT NULL OR NEW.control_kind <> 'none') AND NOT pg_has_role(current_user, 'radcore_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'only a migration adds a system or control account' USING ERRCODE = 'RA006', CONSTRAINT = 'system_account_insert';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.keep_ordinary_account_insert() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER keep_ordinary_account_insert BEFORE INSERT ON radcore.accounts
  FOR EACH ROW EXECUTE FUNCTION radcore.keep_ordinary_account_insert();
--> statement-breakpoint
GRANT INSERT ON radcore.accounts TO radcore_app;
