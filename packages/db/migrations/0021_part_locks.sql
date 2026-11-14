-- RAD-80 (ADR-001 §8b): a part's write locks its record first. A decision locks the record's row and reads its version;
-- a save that writes only a part (a purchase order's line) would otherwise not wait for it, so it could commit after
-- the decision read the version, and the record would read "approved" while its content differs. With this trigger,
-- every insert, update or delete of a part first takes the record's row lock, so a save and a decision on one record
-- never overlap: whichever comes second sees the other's result. It comes with audit_attach's `owner`, so no module
-- can forget it.
CREATE FUNCTION radcore.lock_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  owner_table text := TG_ARGV[0];
  owner_key text := TG_ARGV[1];
  owner_col text := TG_ARGV[2];
  owners text[];
  o text;
BEGIN
  -- The old record and the new one, for a part moved between records; in one order, so two saves can't deadlock.
  SELECT array_agg(DISTINCT v ORDER BY v) INTO owners FROM unnest(array[
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ->> owner_col END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ->> owner_col END]) AS v WHERE v IS NOT NULL;
  FOREACH o IN ARRAY coalesce(owners, '{}') LOOP
    EXECUTE format('SELECT 1 FROM radcore.%I WHERE %I = %L FOR UPDATE', owner_table, owner_key, o);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 0020's audit_attach, where `owner` (the part's column naming its record) now comes with `owner_table` (the record's
-- table), and the part gets the lock_owner trigger. The record's key is its table's one-column primary key.
DROP FUNCTION radcore.audit_attach(text, text[], text[], boolean, text);
--> statement-breakpoint
CREATE FUNCTION radcore.audit_attach(table_name text, keep text[] DEFAULT '{}', redact text[] DEFAULT '{}',
  capture boolean DEFAULT true, owner text DEFAULT NULL, owner_table text DEFAULT NULL) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  rel regclass := format('radcore.%I', table_name)::regclass;
  owner_rel regclass;
  keys text;
  owner_key text;
  bad text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.n) INTO keys
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = rel AND i.indisprimary;
  IF keys IS NULL THEN RAISE EXCEPTION '% has no primary key to audit by', table_name; END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS stamp_who_when ON %s', rel);
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON %s', rel);
  EXECUTE format('DROP TRIGGER IF EXISTS lock_owner ON %s', rel);
  EXECUTE format('CREATE TRIGGER stamp_who_when BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.stamp_who_when()', rel);
  IF NOT capture THEN RETURN; END IF;
  SELECT string_agg(c, ', ') INTO bad FROM unnest(keep || redact) AS c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);
  IF bad IS NOT NULL THEN RAISE EXCEPTION '% has no column %', table_name, bad; END IF;
  SELECT string_agg(c, ', ') INTO bad FROM unnest(keep) AS c WHERE c = ANY (redact);
  IF bad IS NOT NULL THEN RAISE EXCEPTION '%: % is listed both to keep and to redact', table_name, bad; END IF;
  SELECT string_agg(a.attname, ', ') INTO bad FROM pg_attribute a
    WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT (a.attname = ANY (keep || redact || string_to_array(keys, ',')
        || array['created_at', 'created_by', 'updated_at', 'updated_by']));
  IF bad IS NOT NULL THEN RAISE EXCEPTION '%: list % to keep or to redact', table_name, bad; END IF;
  IF (owner IS NULL) <> (owner_table IS NULL) THEN
    RAISE EXCEPTION '%: a part names both its owner column and its owner table', table_name;
  END IF;
  IF owner IS NOT NULL THEN
    IF NOT owner = ANY (keep) THEN
      RAISE EXCEPTION '%: the owner column % must be one of the kept columns', table_name, owner;
    END IF;
    owner_rel := format('radcore.%I', owner_table)::regclass;
    SELECT string_agg(a.attname, ',') INTO owner_key
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
      WHERE i.indrelid = owner_rel AND i.indisprimary;
    IF owner_key IS NULL OR owner_key LIKE '%,%' THEN
      RAISE EXCEPTION '%: its owner % needs a one-column primary key', table_name, owner_table;
    END IF;
    EXECUTE format('CREATE TRIGGER lock_owner BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.lock_owner(%L, %L, %L)',
      rel, owner_table, owner_key, owner);
  END IF;
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.audit_row(%L, %L, %L, %L)',
    rel, keys, array_to_string(keep, ','), array_to_string(redact, ','), coalesce(owner, ''));
END $$;
