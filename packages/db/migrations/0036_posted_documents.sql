-- RAD-86 part 2 (M2-03; ADR-005 §7b; RC-004): posted documents are append-only in the database. Two generic trigger
-- functions, which each posted-document table (an invoice, a credit note, a bill, a payment, an expense, a payslip)
-- attaches in its own migration as it lands (M3 to M6), and the table of the status moves each kind allows.
--
-- state_transitions is made and seeded by hand-written migrations and isn't declared in Drizzle: only the RA004
-- triggers read it (the architect on RAD-86). It equals lib-common's STATE_TRANSITIONS, which tools/posted-documents
-- .test.ts checks. It starts empty: a document's own migration adds its kind's moves.
CREATE TABLE radcore.state_transitions (
  document_table text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
  CONSTRAINT pk_state_transitions PRIMARY KEY (document_table, from_status, to_status),
  CONSTRAINT ck_state_transitions_document_table CHECK (document_table ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_state_transitions_moves CHECK (from_status <> to_status),
  -- Cancelled is final by the table's own rule, not only by what a migration seeds (the auditor on #185).
  CONSTRAINT ck_state_transitions_cancelled_final CHECK (from_status <> 'cancelled')
);
--> statement-breakpoint
-- A change to what a document may do is audited (ADR-005 §5, §7c).
SELECT radcore.audit_attach('state_transitions', keep => array['document_table', 'from_status', 'to_status']);
--> statement-breakpoint
-- Only the owner's migrations write it, and only the triggers, which run as the owner, read it.
REVOKE ALL ON radcore.state_transitions FROM radcore_app;
--> statement-breakpoint
-- RA004 on a posted document (ADR-005 §7b). Attached BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW, with its
-- arguments: the draft status, then the cancel columns and the write-once columns, each comma-separated.
-- - Insert: only as a draft, its cancel and write-once columns null, so nothing is inserted already posted.
-- - A status move: only one state_transitions lists for this table.
-- - A cancel column: written once, from null, only in the update that moves the status to cancelled.
-- - A write-once column (an IRN, an acknowledgement): from null to a value once, never again.
-- - After the draft: nothing else changes. The who-and-when columns and stored generated columns aren't compared.
-- - Delete: a draft only.
CREATE FUNCTION radcore.guard_posted_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  draft text := TG_ARGV[0];
  cancel_columns text[] := coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}');
  once_columns text[] := coalesce(string_to_array(nullif(TG_ARGV[2], ''), ','), '{}');
  ignored text[];
  o jsonb;
  n jsonb;
  c text;
BEGIN
  -- A column named in the trigger's arguments that the table doesn't have would never be checked, so it's refused
  -- on the first write, before anything is written (the auditor on #185).
  FOREACH c IN ARRAY cancel_columns || once_columns LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                   WHERE a.attrelid = TG_RELID AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'guard_posted_document on % names %, which it has no column of', TG_TABLE_NAME, c
        USING ERRCODE = '42703';
    END IF;
  END LOOP;
  IF TG_OP = 'INSERT' THEN
    n := to_jsonb(NEW);
    IF NEW.status IS DISTINCT FROM draft THEN
      RAISE EXCEPTION 'a % starts as %, not %', TG_TABLE_NAME, draft, NEW.status USING ERRCODE = 'RA004';
    END IF;
    FOREACH c IN ARRAY cancel_columns || once_columns LOOP
      IF n->>c IS NOT NULL THEN
        RAISE EXCEPTION 'a new % has no %', TG_TABLE_NAME, c USING ERRCODE = 'RA004';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM draft THEN
      RAISE EXCEPTION 'a % that is % is never deleted', TG_TABLE_NAME, OLD.status USING ERRCODE = 'RA004';
    END IF;
    RETURN OLD;
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (SELECT 1 FROM radcore.state_transitions s
      WHERE s.document_table = TG_TABLE_NAME AND s.from_status = OLD.status AND s.to_status = NEW.status) THEN
    RAISE EXCEPTION 'a % can''t move from % to %', TG_TABLE_NAME, OLD.status, NEW.status USING ERRCODE = 'RA004';
  END IF;
  FOREACH c IN ARRAY cancel_columns LOOP
    IF (o->c) IS DISTINCT FROM (n->c)
       AND (o->>c IS NOT NULL OR NEW.status IS DISTINCT FROM 'cancelled' OR OLD.status = 'cancelled') THEN
      RAISE EXCEPTION 'a %''s % is written once, as it is cancelled', TG_TABLE_NAME, c USING ERRCODE = 'RA004';
    END IF;
  END LOOP;
  FOREACH c IN ARRAY once_columns LOOP
    IF (o->c) IS DISTINCT FROM (n->c) AND o->>c IS NOT NULL THEN
      RAISE EXCEPTION 'a %''s % is written once', TG_TABLE_NAME, c USING ERRCODE = 'RA004';
    END IF;
  END LOOP;
  IF OLD.status = draft THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(a.attname::text), '{}') INTO ignored FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '';
  ignored := ignored || array['status', 'created_at', 'created_by', 'updated_at', 'updated_by'] || cancel_columns || once_columns;
  IF (o - ignored) IS DISTINCT FROM (n - ignored) THEN
    RAISE EXCEPTION 'a % that is % changes only by being cancelled', TG_TABLE_NAME, OLD.status USING ERRCODE = 'RA004';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.guard_posted_document() FROM PUBLIC;
--> statement-breakpoint
-- RA004 on a posted document's lines (ADR-005 §7b). Attached BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW, with
-- its arguments: the parent table, the line's parent column and the draft status. It locks the parent FOR NO KEY
-- UPDATE, the strength the parent's own trigger takes, so the two can't deadlock, and refuses unless the parent is a
-- draft: the OLD parent on update and delete, the NEW one on insert, and a line can't move to another document. A
-- draft deleted with its lines by cascade has no parent row left, and its lines go with it.
CREATE FUNCTION radcore.guard_document_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  parent_column text := TG_ARGV[1];
  draft text := TG_ARGV[2];
  parent uuid;
  status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                 WHERE a.attrelid = TG_RELID AND a.attname = parent_column AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'guard_document_line on % names %, which it has no column of', TG_TABLE_NAME, parent_column
      USING ERRCODE = '42703';
  END IF;
  IF TG_OP = 'INSERT' THEN
    parent := (to_jsonb(NEW)->>parent_column)::uuid;
  ELSE
    parent := (to_jsonb(OLD)->>parent_column)::uuid;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)->>parent_column) IS DISTINCT FROM (to_jsonb(OLD)->>parent_column) THEN
      RAISE EXCEPTION 'a % line stays on its document', parent_table USING ERRCODE = 'RA004';
    END IF;
  END IF;
  EXECUTE format('SELECT status FROM radcore.%I WHERE id = $1 FOR NO KEY UPDATE', parent_table) INTO status USING parent;
  IF status IS NOT NULL AND status <> draft THEN
    RAISE EXCEPTION 'the lines of a % that is % don''t change', parent_table, status USING ERRCODE = 'RA004';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.guard_document_line() FROM PUBLIC;
