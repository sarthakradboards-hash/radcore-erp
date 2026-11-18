CREATE TABLE "radcore"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_key" text,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"type" text NOT NULL,
	"control_kind" text DEFAULT 'none' NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "accounts_systemKey_unique" UNIQUE("system_key"),
	CONSTRAINT "ux_accounts_name_key" UNIQUE("name_key"),
	CONSTRAINT "ux_accounts_id_control_kind" UNIQUE("id","control_kind"),
	CONSTRAINT "ck_accounts_name" CHECK (char_length("radcore"."accounts"."name") <= 120),
	CONSTRAINT "ck_accounts_system_key" CHECK ("radcore"."accounts"."system_key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_accounts_type" CHECK ("radcore"."accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense')),
	CONSTRAINT "ck_accounts_control_kind" CHECK ("radcore"."accounts"."control_kind" in ('none', 'party', 'stock', 'gdni', 'grni', 'gst', 'tds', 'payroll', 'opening', 'year_close')),
	CONSTRAINT "ck_accounts_control_system" CHECK ("radcore"."accounts"."control_kind" = 'none' or "radcore"."accounts"."system_key" is not null)
);
--> statement-breakpoint
CREATE TABLE "radcore"."financial_years" (
	"start" date PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_financial_years_start" CHECK (extract(month from "radcore"."financial_years"."start") = 4 and extract(day from "radcore"."financial_years"."start") = 1)
);
--> statement-breakpoint
CREATE TABLE "radcore"."journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"business_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fy_start" date GENERATED ALWAYS AS (make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)) STORED NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reverses_entry_id" uuid,
	"reason" text,
	"tx_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "journal_entries_number_unique" UNIQUE("number"),
	CONSTRAINT "journal_entries_reversesEntryId_unique" UNIQUE("reverses_entry_id"),
	CONSTRAINT "ux_journal_entries_source" UNIQUE NULLS NOT DISTINCT("source_table","source_id","kind","reverses_entry_id"),
	CONSTRAINT "ux_journal_entries_id_kind" UNIQUE("id","kind"),
	CONSTRAINT "ux_journal_entries_id_kind_date" UNIQUE("id","kind","business_date"),
	CONSTRAINT "ck_journal_entries_reason" CHECK (char_length("radcore"."journal_entries"."reason") <= 500),
	CONSTRAINT "ck_journal_entries_kind" CHECK ("radcore"."journal_entries"."kind" in ('opening', 'goods_receipt', 'purchase_bill', 'supplier_return', 'delivery', 'delivery_return', 'invoice', 'credit_note', 'payment_in', 'payment_out', 'expense', 'stock_transfer', 'stock_adjustment', 'job_work', 'revaluation', 'salary_advance', 'payroll', 'payroll_payment', 'statutory_payment', 'tds_deposit', 'transfer', 'manual', 'year_close')),
	CONSTRAINT "ck_journal_entries_source_table" CHECK ("radcore"."journal_entries"."source_table" ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || "radcore"."journal_entries"."source_table") is not null),
	CONSTRAINT "ck_journal_entries_manual" CHECK ("radcore"."journal_entries"."kind" <> 'manual' or ("radcore"."journal_entries"."source_table" = 'journal_entries' and "radcore"."journal_entries"."source_id" = "radcore"."journal_entries"."id" and "radcore"."journal_entries"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"entry_kind" text NOT NULL,
	"business_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fy_start" date GENERATED ALWAYS AS (make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)) STORED NOT NULL,
	"account_id" uuid NOT NULL,
	"account_control_kind" text NOT NULL,
	"rule_kind" text GENERATED ALWAYS AS (nullif(account_control_kind, 'none')) STORED,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"party_id" uuid,
	"item_id" uuid,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_journal_lines_entry_line" UNIQUE("entry_id","line_no"),
	CONSTRAINT "ck_journal_lines_debit" CHECK ("radcore"."journal_lines"."debit" >= 0 and "radcore"."journal_lines"."debit" <> 'NaN'),
	CONSTRAINT "ck_journal_lines_credit" CHECK ("radcore"."journal_lines"."credit" >= 0 and "radcore"."journal_lines"."credit" <> 'NaN'),
	CONSTRAINT "ck_journal_lines_line_no" CHECK ("radcore"."journal_lines"."line_no" > 0),
	CONSTRAINT "ck_journal_lines_one_side" CHECK (("radcore"."journal_lines"."debit" > 0) <> ("radcore"."journal_lines"."credit" > 0)),
	CONSTRAINT "ck_journal_lines_party" CHECK (("radcore"."journal_lines"."account_control_kind" = 'party') = ("radcore"."journal_lines"."party_id" is not null)),
	CONSTRAINT "ck_journal_lines_stock" CHECK (("radcore"."journal_lines"."account_control_kind" = 'stock') = ("radcore"."journal_lines"."item_id" is not null and "radcore"."journal_lines"."location_id" is not null)
    and ("radcore"."journal_lines"."item_id" is null) = ("radcore"."journal_lines"."location_id" is null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."pending_document_checks" (
	"table_name" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_pending_document_checks" PRIMARY KEY("table_name","document_id")
);
--> statement-breakpoint
CREATE TABLE "radcore"."period_lock" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"locked_through" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_period_lock_one" CHECK ("radcore"."period_lock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "radcore"."posting_rules" (
	"control_kind" text NOT NULL,
	"entry_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_posting_rules" PRIMARY KEY("control_kind","entry_kind")
);
--> statement-breakpoint
DROP VIEW "radcore"."v_schema_missing_triggers";--> statement-breakpoint
ALTER TABLE "radcore"."accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_entries" ADD CONSTRAINT "fk_journal_entries_reverses" FOREIGN KEY ("reverses_entry_id","kind") REFERENCES "radcore"."journal_entries"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_entries" ADD CONSTRAINT "fk_journal_entries_fy_start" FOREIGN KEY ("fy_start") REFERENCES "radcore"."financial_years"("start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_lines" ADD CONSTRAINT "fk_journal_lines_entry" FOREIGN KEY ("entry_id","entry_kind","business_date") REFERENCES "radcore"."journal_entries"("id","kind","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_lines" ADD CONSTRAINT "fk_journal_lines_account" FOREIGN KEY ("account_id","account_control_kind") REFERENCES "radcore"."accounts"("id","control_kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_lines" ADD CONSTRAINT "fk_journal_lines_rule" FOREIGN KEY ("rule_kind","entry_kind") REFERENCES "radcore"."posting_rules"("control_kind","entry_kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."journal_lines" ADD CONSTRAINT "fk_journal_lines_fy_start" FOREIGN KEY ("fy_start") REFERENCES "radcore"."financial_years"("start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_accounts_parent_id" ON "radcore"."accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_journal_entries_business_date" ON "radcore"."journal_entries" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "ix_journal_entries_reverses" ON "radcore"."journal_entries" USING btree ("reverses_entry_id","kind");--> statement-breakpoint
CREATE INDEX "ix_journal_entries_fy_start" ON "radcore"."journal_entries" USING btree ("fy_start");--> statement-breakpoint
CREATE INDEX "ix_journal_lines_account" ON "radcore"."journal_lines" USING btree ("account_id","account_control_kind");--> statement-breakpoint
CREATE INDEX "ix_journal_lines_entry" ON "radcore"."journal_lines" USING btree ("entry_id","entry_kind","business_date");--> statement-breakpoint
CREATE INDEX "ix_journal_lines_rule" ON "radcore"."journal_lines" USING btree ("rule_kind","entry_kind");--> statement-breakpoint
CREATE INDEX "ix_journal_lines_fy_start" ON "radcore"."journal_lines" USING btree ("fy_start");--> statement-breakpoint
CREATE INDEX "ix_journal_lines_party_id" ON "radcore"."journal_lines" USING btree ("party_id");--> statement-breakpoint
CREATE VIEW "radcore"."v_schema_missing_triggers" AS (select n.nspname::text as schema_name, c.relname::text as table_name, t.name::text as missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('stamp_who_when'), ('audit_row')) as t(name)
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss', 'drizzle', 'radcore_ext', 'ratelimit')
    and left(n.nspname, 3) <> 'pg_'
    and not (t.name = 'audit_row' and n.nspname = 'radcore'
      and c.relname in ('audit_log', 'access_log', 'event_log', 'saved_once', 'jobs_outbox', 'webhook_deliveries', 'sessions',
        'change_reasons', 'user_sign_ins', 'number_counters', 'pending_document_checks'))
    and not exists (select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = c.oid and g.tgname = t.name and not g.tgisinternal));-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE ON "radcore"."v_schema_missing_triggers" FROM radcore_app;
--> statement-breakpoint
-- RAD-86 (ADR-006 §2, RC-093): which entry kinds may post to each control kind, equal to lib-common's POSTING_RULES
-- (tools/journal.test.ts checks). Read-only to the app.
INSERT INTO radcore.posting_rules (control_kind, entry_kind) VALUES
  ('party', 'opening'), ('party', 'invoice'), ('party', 'credit_note'), ('party', 'purchase_bill'),
  ('party', 'supplier_return'), ('party', 'expense'), ('party', 'payment_in'), ('party', 'payment_out'),
  ('stock', 'opening'), ('stock', 'goods_receipt'), ('stock', 'purchase_bill'), ('stock', 'supplier_return'),
  ('stock', 'delivery'), ('stock', 'delivery_return'), ('stock', 'credit_note'), ('stock', 'stock_transfer'),
  ('stock', 'stock_adjustment'), ('stock', 'job_work'), ('stock', 'revaluation'),
  ('gdni', 'opening'), ('gdni', 'delivery'), ('gdni', 'delivery_return'), ('gdni', 'invoice'), ('gdni', 'credit_note'),
  ('grni', 'opening'), ('grni', 'goods_receipt'), ('grni', 'purchase_bill'), ('grni', 'supplier_return'), ('grni', 'job_work'),
  ('gst', 'opening'), ('gst', 'invoice'), ('gst', 'credit_note'), ('gst', 'purchase_bill'), ('gst', 'supplier_return'),
  ('gst', 'expense'),
  ('tds', 'opening'), ('tds', 'invoice'), ('tds', 'purchase_bill'), ('tds', 'expense'), ('tds', 'payment_in'),
  ('tds', 'payment_out'), ('tds', 'payroll'), ('tds', 'tds_deposit'),
  ('payroll', 'opening'), ('payroll', 'payroll'), ('payroll', 'payroll_payment'), ('payroll', 'salary_advance'),
  ('payroll', 'statutory_payment'),
  ('opening', 'opening'),
  ('year_close', 'year_close');
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.posting_rules FROM radcore_app;
--> statement-breakpoint
-- The system accounts (ADR-006 §2), equal to lib-common's SYSTEM_ACCOUNTS (tools/journal.test.ts checks).
INSERT INTO radcore.accounts (system_key, name, type, control_kind) VALUES
  ('cash', 'Cash', 'asset', 'none'),
  ('bank', 'Bank', 'asset', 'none'),
  ('debtors', 'Debtors', 'asset', 'party'),
  ('stock', 'Stock in Hand', 'asset', 'stock'),
  ('gdni', 'Goods Delivered Not Invoiced', 'asset', 'gdni'),
  ('input_cgst', 'Input CGST', 'asset', 'gst'),
  ('input_sgst', 'Input SGST', 'asset', 'gst'),
  ('input_igst', 'Input IGST', 'asset', 'gst'),
  ('input_cess', 'Input Cess', 'asset', 'gst'),
  ('tds_receivable', 'TDS Receivable', 'asset', 'tds'),
  ('staff_advances', 'Staff Advances', 'asset', 'payroll'),
  ('creditors', 'Creditors', 'liability', 'party'),
  ('grni', 'Goods Received Not Billed', 'liability', 'grni'),
  ('jw_accrued', 'Job Work Charges to be Billed', 'liability', 'grni'),
  ('output_cgst', 'Output CGST', 'liability', 'gst'),
  ('output_sgst', 'Output SGST', 'liability', 'gst'),
  ('output_igst', 'Output IGST', 'liability', 'gst'),
  ('output_cess', 'Output Cess', 'liability', 'gst'),
  ('tds_payable', 'TDS Payable', 'liability', 'tds'),
  ('tcs_payable', 'TCS Payable', 'liability', 'tds'),
  ('salaries_payable', 'Salaries Payable', 'liability', 'payroll'),
  ('pf_payable', 'PF Payable', 'liability', 'payroll'),
  ('esic_payable', 'ESIC Payable', 'liability', 'payroll'),
  ('pt_payable', 'Professional Tax Payable', 'liability', 'payroll'),
  ('opening_equity', 'Opening Balance Equity', 'equity', 'opening'),
  ('retained_earnings', 'Retained Earnings', 'equity', 'year_close'),
  ('sales', 'Sales', 'income', 'none'),
  ('fx_difference', 'Foreign Exchange Gain / Loss', 'income', 'none'),
  ('cogs', 'Cost of Goods Sold', 'expense', 'none'),
  ('stock_adjustment', 'Stock Adjustment', 'expense', 'none'),
  ('round_off', 'Round Off', 'expense', 'none'),
  ('salaries', 'Salaries', 'expense', 'none'),
  ('employer_pf', 'Employer PF', 'expense', 'none'),
  ('employer_esic', 'Employer ESIC', 'expense', 'none');
--> statement-breakpoint
-- People add ordinary accounts and rename any; only the seed sets a system key, and only a system account is a
-- control account (ADR-006 §2). Column grants hold that: the app writes no system_key, and moves no control kind.
REVOKE INSERT, UPDATE ON radcore.accounts FROM radcore_app;
--> statement-breakpoint
GRANT INSERT (name, type, parent_id) ON radcore.accounts TO radcore_app;
--> statement-breakpoint
GRANT UPDATE (name, parent_id) ON radcore.accounts TO radcore_app;
--> statement-breakpoint
-- A system account is renamed, never removed (ADR-006 §2).
CREATE FUNCTION radcore.keep_system_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF OLD.system_key IS NOT NULL THEN
    RAISE EXCEPTION 'system account % can be renamed, never removed', OLD.system_key USING ERRCODE = 'RA001';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER keep_system_account BEFORE DELETE ON radcore.accounts FOR EACH ROW EXECUTE FUNCTION radcore.keep_system_account();
--> statement-breakpoint
INSERT INTO radcore.period_lock (id) VALUES (1);
--> statement-breakpoint
-- An entry is stamped with the database's own posting time and transaction (ADR-005 §6), and refused on or before
-- the period lock (RA003, RC-163). The engine has read the lock row FOR SHARE first, so the check is under the lock.
CREATE FUNCTION radcore.guard_journal_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  locked date;
BEGIN
  NEW.posted_at := now();
  NEW.tx_id := pg_current_xact_id()::text::bigint;
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked THEN
    RAISE EXCEPTION 'the books are locked through %, so nothing posts on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_journal_entry BEFORE INSERT ON radcore.journal_entries FOR EACH ROW EXECUTE FUNCTION radcore.guard_journal_entry();
--> statement-breakpoint
-- A line is written with its entry, in the same transaction, never added to a posted one later. Its date is the
-- entry's (the composite foreign key), so the entry's lock check covers it.
CREATE FUNCTION radcore.guard_journal_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  NEW.posted_at := now();
  IF NOT EXISTS (SELECT 1 FROM radcore.journal_entries e
                 WHERE e.id = NEW.entry_id AND e.tx_id = pg_current_xact_id()::text::bigint) THEN
    RAISE EXCEPTION 'a journal line is written with its entry, never added to a posted one' USING ERRCODE = 'RA001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_journal_line BEFORE INSERT ON radcore.journal_lines FOR EACH ROW EXECUTE FUNCTION radcore.guard_journal_line();
--> statement-breakpoint
-- Append-only (ADR-005 §7): a correction is a reversal, never an edit. The app login holds no UPDATE, DELETE or
-- TRUNCATE either.
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.journal_entries FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.journal_entries FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.journal_lines FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.journal_lines FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.journal_entries, radcore.journal_lines FROM radcore_app;
--> statement-breakpoint
-- Each entry an insert touched is checked once, at commit (ADR-005 §2): statement triggers note its id, and a
-- deferred trigger on pending_document_checks checks it and removes the row.
CREATE FUNCTION radcore.note_journal_entries() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT DISTINCT 'journal_entries', n.id FROM new_rows n ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_check AFTER INSERT ON radcore.journal_entries REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_journal_entries();
--> statement-breakpoint
CREATE FUNCTION radcore.note_journal_lines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  INSERT INTO radcore.pending_document_checks (table_name, document_id)
    SELECT DISTINCT 'journal_entries', n.entry_id FROM new_rows n ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_check AFTER INSERT ON radcore.journal_lines REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION radcore.note_journal_lines();
--> statement-breakpoint
-- RA002: an entry has two lines or more, its debits equal its credits, and a reversal is its original's lines with
-- debit and credit swapped, line for line (ADR-006 §3).
CREATE FUNCTION radcore.check_journal_entry(entry uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  e radcore.journal_entries%ROWTYPE;
  lines int;
  debits numeric;
  credits numeric;
  differ int;
BEGIN
  SELECT * INTO e FROM radcore.journal_entries WHERE id = entry;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO lines, debits, credits
    FROM radcore.journal_lines WHERE entry_id = entry;
  IF lines < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'journal entry % doesn''t balance: % lines, debits %, credits %', e.number, lines, debits, credits
      USING ERRCODE = 'RA002';
  END IF;
  IF e.reverses_entry_id IS NOT NULL THEN
    SELECT count(*) INTO differ FROM (
      (SELECT line_no, account_id, party_id, item_id, location_id, credit AS debit, debit AS credit
         FROM radcore.journal_lines WHERE entry_id = e.reverses_entry_id
       EXCEPT ALL
       SELECT line_no, account_id, party_id, item_id, location_id, debit, credit FROM radcore.journal_lines WHERE entry_id = entry)
      UNION ALL
      (SELECT line_no, account_id, party_id, item_id, location_id, debit, credit FROM radcore.journal_lines WHERE entry_id = entry
       EXCEPT ALL
       SELECT line_no, account_id, party_id, item_id, location_id, credit AS debit, debit AS credit
         FROM radcore.journal_lines WHERE entry_id = e.reverses_entry_id)) d;
    IF differ > 0 THEN
      RAISE EXCEPTION 'journal entry % isn''t its original''s lines with debit and credit swapped', e.number
        USING ERRCODE = 'RA002';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_journal_entry(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION radcore.check_pending_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.table_name = 'journal_entries' THEN
    PERFORM radcore.check_journal_entry(NEW.document_id);
  ELSE
    RAISE EXCEPTION 'no check for documents of %', NEW.table_name;
  END IF;
  DELETE FROM radcore.pending_document_checks WHERE table_name = NEW.table_name AND document_id = NEW.document_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_pending_document AFTER INSERT ON radcore.pending_document_checks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION radcore.check_pending_document();
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c). The journal is a ledger, audited in full, every column kept: its own
-- rows don't record the login or client address that wrote them, and the audit row does (the architect on RAD-93).
SELECT radcore.audit_attach('accounts', keep => array['system_key', 'name', 'name_key', 'type', 'control_kind', 'parent_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('posting_rules', keep => array['control_kind', 'entry_kind']);
--> statement-breakpoint
SELECT radcore.audit_attach('financial_years', keep => array['start']);
--> statement-breakpoint
SELECT radcore.audit_attach('period_lock', keep => array['locked_through']);
--> statement-breakpoint
SELECT radcore.audit_attach('journal_entries', keep => array['number', 'kind', 'business_date', 'posted_at', 'fy_start',
  'source_table', 'source_id', 'reverses_entry_id', 'tx_id', 'reason']);
--> statement-breakpoint
SELECT radcore.audit_attach('journal_lines', keep => array['entry_id', 'line_no', 'entry_kind', 'business_date', 'posted_at',
  'fy_start', 'account_id', 'account_control_kind', 'rule_kind', 'debit', 'credit', 'party_id', 'item_id', 'location_id']);
--> statement-breakpoint
-- Machinery (ADR-005 §7c): stamped who-and-when, not row-audited; empty between transactions.
SELECT radcore.audit_attach('pending_document_checks', capture => false);
