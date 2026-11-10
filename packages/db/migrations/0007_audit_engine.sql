-- RAD-30 (M1-12, RC-030, RC-046, ADR-005 §5, §7, §7c, §8): the audit engine, in the database.
-- * Who and when: every table's created_* and updated_* are stamped from the request context by a trigger; a write
--   with no principal fails with RA005.
-- * Every insert, update and delete is written to audit_log by a trigger, never by a hand-written call. Columns that
--   hold a secret or a hash are written as "[redacted]".
-- * audit_log, access_log and event_log are append-only (RA001) and partitioned by month on occurred_at. The
--   occurred_at is the database's own: a value more than 5 minutes from now() is refused.
-- * The app login has no INSERT, UPDATE, DELETE or TRUNCATE on audit_log and access_log, and no privilege at all on
--   any partition. access_log is written only through record_access().
-- Every function is owned by radcore_owner (this migration runs as the owner) with a fixed search_path, pg_temp
-- last, so a session's temporary table can't stand in for a log.

-- RA001: an append-only row was changed, deleted or truncated.
CREATE FUNCTION radcore.refuse_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'RA001';
END $$;
--> statement-breakpoint

-- ADR-005 §5: always stamped from the request context, so the application can't set or forge them.
CREATE FUNCTION radcore.stamp_who_when() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  principal text := nullif(current_setting('app.principal', true), '');
BEGIN
  IF principal IS NULL THEN
    RAISE EXCEPTION 'a write to % needs a principal in the request context', TG_TABLE_NAME USING ERRCODE = 'RA005';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := principal;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := principal;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- ADR-005 §8: a log's time is the database's. A caller-supplied occurred_at far from now() could plant a row ahead
-- of every partition and break the next top-up.
CREATE FUNCTION radcore.guard_occurred_at() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF abs(extract(epoch FROM NEW.occurred_at - now())) > 300 THEN
    RAISE EXCEPTION '%.occurred_at must be the time of the write', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- The three logs. Their four who-and-when columns are stamped like any table's; on a log, updated_* = created_*.
CREATE TABLE radcore.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  op text NOT NULL CONSTRAINT ck_audit_log_op CHECK (op IN ('insert', 'update', 'delete')),
  changed jsonb NOT NULL,
  login_name text NOT NULL DEFAULT session_user,
  client_addr inet DEFAULT inet_client_addr(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  CONSTRAINT pk_audit_log PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE TABLE radcore.access_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  record_table text NOT NULL,
  record_id text NOT NULL,
  login_name text NOT NULL DEFAULT session_user,
  client_addr inet DEFAULT inet_client_addr(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  CONSTRAINT pk_access_log PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
-- The security events (RAD-31 adds what writes them).
CREATE TABLE radcore.event_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  login_name text NOT NULL DEFAULT session_user,
  client_addr inet DEFAULT inet_client_addr(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT nullif(current_setting('app.principal', true), ''),
  CONSTRAINT pk_event_log PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint

-- Each log: who and when, the time guard, and append-only. Row triggers on a partitioned table reach every
-- partition, now and later; a TRUNCATE trigger doesn't, so each partition gets its own (add_log_partitions).
DO $$
DECLARE log text;
BEGIN
  FOREACH log IN ARRAY array['audit_log', 'access_log', 'event_log'] LOOP
    EXECUTE format('CREATE TRIGGER stamp_who_when BEFORE INSERT ON radcore.%I FOR EACH ROW EXECUTE FUNCTION radcore.stamp_who_when()', log);
    EXECUTE format('CREATE TRIGGER guard_occurred_at BEFORE INSERT ON radcore.%I FOR EACH ROW EXECUTE FUNCTION radcore.guard_occurred_at()', log);
    EXECUTE format('CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.%I FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change()', log);
    EXECUTE format('CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.%I FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change()', log);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON radcore.%I FROM radcore_app', log);
  END LOOP;
END $$;
--> statement-breakpoint
-- Written only by the audit trigger and record_access, never by an INSERT from the app (ADR-005 §7c).
REVOKE INSERT ON radcore.audit_log, radcore.access_log FROM radcore_app;
--> statement-breakpoint

-- The months each log has a partition for, from this month to `months_ahead` months on, in UTC. Idempotent: the
-- deploy's top-up calls it again (ADR-005 §8). Each new partition is closed to both logins, so rows reach it only
-- through the parent's grants, and gets its own TRUNCATE trigger.
CREATE FUNCTION radcore.add_log_partitions(months_ahead int) RETURNS int LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  log text;
  month date;
  part text;
  made int := 0;
BEGIN
  FOREACH log IN ARRAY array['audit_log', 'access_log', 'event_log'] LOOP
    FOR i IN 0..months_ahead LOOP
      month := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
      part := format('%s_%s', log, to_char(month, 'YYYY_MM'));
      CONTINUE WHEN to_regclass(format('radcore.%I', part)) IS NOT NULL;
      EXECUTE format('CREATE TABLE radcore.%I PARTITION OF radcore.%I FOR VALUES FROM (%L) TO (%L)', part, log,
        month::text || ' 00:00:00+00', (month + interval '1 month')::date::text || ' 00:00:00+00');
      EXECUTE format('REVOKE ALL ON radcore.%I FROM radcore_app, radcore_read', part);
      EXECUTE format('CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.%I FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change()', part);
      made := made + 1;
    END LOOP;
  END LOOP;
  RETURN made;
END $$;
--> statement-breakpoint

-- The default partitions catch only a row outside every month, which should never happen; the watch job alerts on
-- one (ADR-005 §8). Then the first 24 months.
DO $$
DECLARE log text;
BEGIN
  FOREACH log IN ARRAY array['audit_log', 'access_log', 'event_log'] LOOP
    EXECUTE format('CREATE TABLE radcore.%I PARTITION OF radcore.%I DEFAULT', log || '_default', log);
    EXECUTE format('REVOKE ALL ON radcore.%I FROM radcore_app, radcore_read', log || '_default');
    EXECUTE format('CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.%I FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change()', log || '_default');
  END LOOP;
END $$;
--> statement-breakpoint
SELECT radcore.add_log_partitions(23);
--> statement-breakpoint

-- Every write to an audited table, as one audit_log row. The trigger's arguments, set by audit_attach: the primary
-- key's columns, then the columns written as "[redacted]". An update records only the columns that changed, old and
-- new, leaving out the updated_* stamps; an update that changed nothing else writes no row.
CREATE FUNCTION radcore.audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  keys text[] := string_to_array(TG_ARGV[0], ',');
  redact text[] := coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}');
  old_row jsonb;
  new_row jsonb;
  this_row jsonb;
  changed jsonb := '{}';
  col text;
  rid text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  this_row := coalesce(new_row, old_row);
  SELECT string_agg(this_row ->> k.c, ',' ORDER BY k.n) INTO rid FROM unnest(keys) WITH ORDINALITY AS k(c, n);
  IF TG_OP = 'UPDATE' THEN
    FOR col IN SELECT jsonb_object_keys(new_row) LOOP
      CONTINUE WHEN col IN ('updated_at', 'updated_by') OR (new_row -> col) IS NOT DISTINCT FROM (old_row -> col);
      changed := changed || jsonb_build_object(col, CASE WHEN col = ANY (redact) THEN '"[redacted]"'::jsonb
        ELSE jsonb_build_object('old', old_row -> col, 'new', new_row -> col) END);
    END LOOP;
    IF changed = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    changed := this_row;
    FOREACH col IN ARRAY redact LOOP
      IF changed ? col THEN changed := jsonb_set(changed, array[col], '"[redacted]"'); END IF;
    END LOOP;
  END IF;
  INSERT INTO radcore.audit_log (table_name, record_id, op, changed) VALUES (TG_TABLE_NAME, rid, lower(TG_OP), changed);
  RETURN NULL;
END $$;
--> statement-breakpoint

-- What every table's migration calls (this one, for the tables already made): the who-and-when trigger and the audit
-- trigger, with the columns to redact. The schema test fails on a table in radcore without both (ADR-005 §5).
CREATE FUNCTION radcore.audit_attach(table_name text, redact text[] DEFAULT '{}') RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  rel regclass := format('radcore.%I', table_name)::regclass;
  keys text;
  missing text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.n) INTO keys
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = rel AND i.indisprimary;
  IF keys IS NULL THEN RAISE EXCEPTION '% has no primary key to audit by', table_name; END IF;
  SELECT string_agg(c, ', ') INTO missing FROM unnest(redact) AS c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = c AND NOT a.attisdropped);
  IF missing IS NOT NULL THEN RAISE EXCEPTION '% has no column % to redact', table_name, missing; END IF;
  EXECUTE format('CREATE TRIGGER stamp_who_when BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.stamp_who_when()', rel);
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.audit_row(%L, %L)',
    rel, keys, array_to_string(redact, ','));
END $$;
--> statement-breakpoint

SELECT radcore.audit_attach('settings');
--> statement-breakpoint
SELECT radcore.audit_attach('secrets', array['ciphertext']);
--> statement-breakpoint
SELECT radcore.audit_attach('users', array['password_hash']);
--> statement-breakpoint
SELECT radcore.audit_attach('invites', array['token_hash']);
--> statement-breakpoint
SELECT radcore.audit_attach('password_resets', array['token_hash']);
--> statement-breakpoint

-- A record opened in full, logged as its own short write after the read commits (ADR-005 §7c). No principal or time
-- argument: they come from the request context and now(), so the app can append an access row but not say who or
-- when. Only the app login may call it.
CREATE FUNCTION radcore.record_access(record_table text, record_id text) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
  INSERT INTO radcore.access_log (record_table, record_id) VALUES ($1, $2);
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.record_access(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION radcore.record_access(text, text) TO radcore_app;
