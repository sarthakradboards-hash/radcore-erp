-- RAD-36 (the auditor on #146): every person has a user_sign_ins row, so the people list, which joins it inner, can't
-- miss anyone. The database makes it with the person, whatever path inserts them, rather than each path remembering.
-- Runs as the inserting role (no SECURITY DEFINER): the app already writes user_sign_ins. The row is stamped
-- who-and-when like any other, from the same request context as the person's insert.
CREATE FUNCTION radcore.add_user_sign_in() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.user_sign_ins (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.add_user_sign_in() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER add_user_sign_in AFTER INSERT ON radcore.users FOR EACH ROW EXECUTE FUNCTION radcore.add_user_sign_in();
