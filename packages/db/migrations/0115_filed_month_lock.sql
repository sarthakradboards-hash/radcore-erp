CREATE TABLE "radcore"."gst_filed_lock" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"gstr1_through" date,
	"gstr3b_through" date,
	CONSTRAINT "ck_gst_filed_lock_one" CHECK ("radcore"."gst_filed_lock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "radcore"."gst_filings" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return" text NOT NULL,
	"month" date NOT NULL,
	"arn" text NOT NULL,
	"filed_on" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "ck_gst_filings_arn" CHECK (char_length("radcore"."gst_filings"."arn") <= 40),
	CONSTRAINT "ck_gst_filings_return" CHECK ("radcore"."gst_filings"."return" in ('gstr1', 'gstr3b')),
	CONSTRAINT "ck_gst_filings_month" CHECK (extract(day from "radcore"."gst_filings"."month") = 1),
	CONSTRAINT "ck_gst_filings_sha256" CHECK ("radcore"."gst_filings"."snapshot_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_gst_filings_live" ON "radcore"."gst_filings" USING btree ("return","month") WHERE "radcore"."gst_filings"."undone_at" is null;--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read', 'gst:returns', 'gst:file') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read', 'gst:returns', 'gst:file') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- RAD-156 (M5-08; ADR-009 §5, §7; RC-012): the filed-month lock. One row; the app login may lock it (UPDATE on `id`
-- alone, which ck_gst_filed_lock_one pins to 1), never move it: radcore.set_filed_lock is the way.
INSERT INTO radcore.gst_filed_lock (id) VALUES (1);
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.gst_filed_lock FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (id) ON radcore.gst_filed_lock TO radcore_app;
--> statement-breakpoint
CREATE FUNCTION radcore.set_filed_lock(ret text, through date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF ret = 'gstr1' THEN
    UPDATE radcore.gst_filed_lock SET gstr1_through = through WHERE id = 1;
  ELSIF ret = 'gstr3b' THEN
    UPDATE radcore.gst_filed_lock SET gstr3b_through = through WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'no such return: %', ret;
  END IF;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.set_filed_lock(text, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION radcore.set_filed_lock(text, date) TO radcore_app;
--> statement-breakpoint
-- Every door, by entry kind (ADR-009 §5): an outward entry (invoice, credit note) on or before GSTR-1's month, and any
-- kind 3B reports on or before 3B's, is refused (RA010); so is a reversal of an outward entry whose original is in a
-- GSTR-1-filed month, since a reversal is dated today. lib-accounts' postEntry and reverseEntry refuse them by name
-- (month_filed) first; this is the backstop. The period lock is as 0095 left it.
CREATE OR REPLACE FUNCTION radcore.guard_journal_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  locked date;
  filed radcore.gst_filed_lock%ROWTYPE;
  original date;
BEGIN
  NEW.posted_at := now();
  NEW.tx_id := pg_current_xact_id()::text::bigint;
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked
     AND NOT (NEW.kind = 'year_close' AND extract(month from NEW.business_date) = 3 AND extract(day from NEW.business_date) = 31) THEN
    RAISE EXCEPTION 'the books are locked through %, so nothing posts on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  SELECT * INTO filed FROM radcore.gst_filed_lock WHERE id = 1;
  IF NEW.kind IN ('invoice', 'credit_note') AND filed.gstr1_through IS NOT NULL AND NEW.business_date <= filed.gstr1_through THEN
    RAISE EXCEPTION 'GSTR-1 is filed through %, so no % posts on %', filed.gstr1_through, NEW.kind, NEW.business_date USING ERRCODE = 'RA010';
  END IF;
  IF NEW.kind IN ('invoice', 'credit_note', 'purchase_bill', 'supplier_return', 'expense') AND filed.gstr3b_through IS NOT NULL
     AND NEW.business_date <= filed.gstr3b_through THEN
    RAISE EXCEPTION 'GSTR-3B is filed through %, so no % posts on %', filed.gstr3b_through, NEW.kind, NEW.business_date USING ERRCODE = 'RA010';
  END IF;
  IF NEW.reverses_entry_id IS NOT NULL AND NEW.kind IN ('invoice', 'credit_note') AND filed.gstr1_through IS NOT NULL THEN
    SELECT business_date INTO original FROM radcore.journal_entries WHERE id = NEW.reverses_entry_id;
    IF original <= filed.gstr1_through THEN
      RAISE EXCEPTION 'GSTR-1 is filed through %, so the % of % is corrected, not cancelled', filed.gstr1_through, NEW.kind, original
        USING ERRCODE = 'RA010';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A filing is written once; undoing it (RAD-156 PR 2) only stamps undone_at. UPDATE on that column alone.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.gst_filings FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (undone_at) ON radcore.gst_filings TO radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('gst_filed_lock', keep => array['gstr1_through', 'gstr3b_through']);
--> statement-breakpoint
SELECT radcore.audit_attach('gst_filings', keep => array['return', 'month', 'arn', 'filed_on', 'snapshot', 'snapshot_sha256', 'undone_at']);
--> statement-breakpoint
-- gst:file (ADR-009 §9): all-only, listed in the role-scope CHECKs above. Accounts and the admin mark returns filed.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'gst:file', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'gst:file', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
