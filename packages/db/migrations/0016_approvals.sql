CREATE TABLE "radcore"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"record_id" uuid NOT NULL,
	"version_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_approvals_reason" CHECK (char_length("radcore"."approvals"."reason") <= 500),
	CONSTRAINT "ck_approvals_kind" CHECK ("radcore"."approvals"."kind" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "ck_approvals_version_hash" CHECK ("radcore"."approvals"."version_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_approvals_status" CHECK ("radcore"."approvals"."status" in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "ck_approvals_decided" CHECK (("radcore"."approvals"."status" = 'pending') = ("radcore"."approvals"."decided_at" is null)
    and ("radcore"."approvals"."status" in ('approved', 'rejected')) = ("radcore"."approvals"."decided_by" is not null)
    and ("radcore"."approvals"."decided_by" is null or "radcore"."approvals"."decided_by" <> "radcore"."approvals"."requested_by"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_approvals_pending" ON "radcore"."approvals" USING btree ("kind","record_id") WHERE "radcore"."approvals"."decided_at" is null;--> statement-breakpoint
CREATE INDEX "ix_approvals_kind_status" ON "radcore"."approvals" USING btree ("kind","status","created_at");--> statement-breakpoint
-- A record people make (ADR-005 §5, §7c): audited, every column kept, since who asked, who decided and what they
-- decided on is the point of the table (RC-037).
SELECT radcore.audit_attach('approvals', keep => array['kind', 'record_id', 'version_hash', 'requested_by', 'status', 'decided_by', 'decided_at', 'reason']);
--> statement-breakpoint
-- RAD-38 (ADR-001 §8b): a part's audit rows name the record it belongs to, so maker-checker can find everyone who
-- changed a record or any of its parts since the record's last approval. A part table (a purchase order's lines) is
-- attached with `owner => '<its record's key column>'`, and each of its audit rows stores that value as owner_id.
ALTER TABLE radcore.audit_log ADD COLUMN owner_id text;
--> statement-breakpoint
-- The two reads behind a decision: a record's own rows, and its parts' rows, each after a time. On the partitioned
-- table, so every partition (and every partition add_log_partitions makes later) has them.
CREATE INDEX ix_audit_log_table_record ON radcore.audit_log (table_name, record_id, occurred_at);
--> statement-breakpoint
CREATE INDEX ix_audit_log_owner ON radcore.audit_log (owner_id, occurred_at) WHERE owner_id IS NOT NULL;
--> statement-breakpoint
-- 0011's audit_row, with a fourth argument: the owner column, whose value goes in owner_id. A trigger attached
-- before this has three arguments, and TG_ARGV[3] is then null, so its rows carry no owner_id, as before.
CREATE OR REPLACE FUNCTION radcore.audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  keys text[] := string_to_array(TG_ARGV[0], ',');
  keep text[] := coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}');
  redact text[] := coalesce(string_to_array(nullif(TG_ARGV[2], ''), ','), '{}');
  owner_col text := nullif(TG_ARGV[3], '');
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
  FOREACH col IN ARRAY keep || redact LOOP
    IF TG_OP = 'UPDATE' THEN
      CONTINUE WHEN (new_row -> col) IS NOT DISTINCT FROM (old_row -> col);
      changed := changed || jsonb_build_object(col, CASE WHEN col = ANY (redact) THEN '"[redacted]"'::jsonb
        ELSE jsonb_build_object('old', old_row -> col, 'new', new_row -> col) END);
    ELSE
      changed := changed || jsonb_build_object(col, CASE WHEN col = ANY (redact) THEN '"[redacted]"'::jsonb
        ELSE this_row -> col END);
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND changed = '{}'::jsonb THEN RETURN NULL; END IF;
  INSERT INTO radcore.audit_log (table_name, record_id, op, changed, owner_id)
    VALUES (TG_TABLE_NAME, rid, lower(TG_OP), changed, CASE WHEN owner_col IS NOT NULL THEN this_row ->> owner_col END);
  -- A part moved to another record changed both: the old one gets its own row.
  IF TG_OP = 'UPDATE' AND owner_col IS NOT NULL AND (old_row ->> owner_col) IS DISTINCT FROM (new_row ->> owner_col) THEN
    INSERT INTO radcore.audit_log (table_name, record_id, op, changed, owner_id)
      VALUES (TG_TABLE_NAME, rid, 'update', changed, old_row ->> owner_col);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- 0011's audit_attach with `owner`: the column naming the record a part belongs to, which must be one of the kept
-- columns (a foreign key is a business value). Recreated rather than overloaded, so every call keeps one meaning.
DROP FUNCTION radcore.audit_attach(text, text[], text[], boolean);
--> statement-breakpoint
CREATE FUNCTION radcore.audit_attach(table_name text, keep text[] DEFAULT '{}', redact text[] DEFAULT '{}',
  capture boolean DEFAULT true, owner text DEFAULT NULL) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  rel regclass := format('radcore.%I', table_name)::regclass;
  keys text;
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
  IF owner IS NOT NULL AND NOT owner = ANY (keep) THEN
    RAISE EXCEPTION '%: the owner column % must be one of the kept columns', table_name, owner;
  END IF;
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION radcore.audit_row(%L, %L, %L, %L)',
    rel, keys, array_to_string(keep, ','), array_to_string(redact, ','), coalesce(owner, ''));
END $$;
