CREATE TABLE "radcore"."period_unlock_requests" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"through" date NOT NULL,
	"reason" text NOT NULL,
	"lock_was" date NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "ck_period_unlock_requests_reason" CHECK (char_length("radcore"."period_unlock_requests"."reason") <= 500),
	CONSTRAINT "ck_period_unlock_requests_kind" CHECK ("radcore"."period_unlock_requests"."kind" in ('move_back', 'reopen_year')),
	CONSTRAINT "ck_period_unlock_requests_back" CHECK ("radcore"."period_unlock_requests"."through" < "radcore"."period_unlock_requests"."lock_was")
);
--> statement-breakpoint
CREATE TABLE "radcore"."year_closes" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fy_start" date NOT NULL,
	"ticks" jsonb NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" uuid,
	CONSTRAINT "ck_year_closes_reopened" CHECK (("radcore"."year_closes"."reopened_at" is null) = ("radcore"."year_closes"."reopened_by" is null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."year_closes" ADD CONSTRAINT "year_closes_fy_start_financial_years_start_fk" FOREIGN KEY ("fy_start") REFERENCES "radcore"."financial_years"("start") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."year_closes" ADD CONSTRAINT "year_closes_reopened_by_period_unlock_requests_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "radcore"."period_unlock_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_year_closes_live" ON "radcore"."year_closes" USING btree ("fy_start") WHERE "radcore"."year_closes"."reopened_at" is null;--> statement-breakpoint
CREATE INDEX "ix_year_closes_fy_start" ON "radcore"."year_closes" USING btree ("fy_start");--> statement-breakpoint
CREATE INDEX "ix_year_closes_reopened_by" ON "radcore"."year_closes" USING btree ("reopened_by");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- RAD-157 (M5-09; ADR-009 §6, §7): the period lock and year close. An entry is still refused on or before the period
-- lock (RA003), but for the year-end close and its reversal, dated their year's 31 March: the close needs the lock at
-- or past that day, so nothing else in the year can change while it reads the balances.
CREATE OR REPLACE FUNCTION radcore.guard_journal_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  locked date;
BEGIN
  NEW.posted_at := now();
  NEW.tx_id := pg_current_xact_id()::text::bigint;
  SELECT locked_through INTO locked FROM radcore.period_lock WHERE id = 1;
  IF locked IS NOT NULL AND NEW.business_date <= locked
     AND NOT (NEW.kind = 'year_close' AND extract(month from NEW.business_date) = 3 AND extract(day from NEW.business_date) = 31) THEN
    RAISE EXCEPTION 'the books are locked through %, so nothing posts on %', locked, NEW.business_date USING ERRCODE = 'RA003';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The lock moves only here (0041 left the app login no write on it): lib-accounts' period-lock service calls it with the
-- row already held FOR UPDATE, after its own checks (forward freely, back only on an approved request). period_lock is
-- audited, so every move is in the trail with who made it.
CREATE FUNCTION radcore.set_period_lock(through date) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
  UPDATE radcore.period_lock SET locked_through = $1 WHERE id = 1;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.set_period_lock(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION radcore.set_period_lock(date) TO radcore_app;
--> statement-breakpoint
-- A request is written once; its approval only stamps applied_at. A close is written once; a reopen only marks it.
-- UPDATE on those columns alone, which also lets the service lock the row FOR UPDATE.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.period_unlock_requests, radcore.year_closes FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (applied_at) ON radcore.period_unlock_requests TO radcore_app;
--> statement-breakpoint
GRANT UPDATE (reopened_at, reopened_by) ON radcore.year_closes TO radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('period_unlock_requests', keep => array['kind', 'through', 'reason', 'lock_was', 'applied_at']);
--> statement-breakpoint
SELECT radcore.audit_attach('year_closes', keep => array['fy_start', 'ticks', 'reopened_at', 'reopened_by']);
--> statement-breakpoint
-- books:lock and books:unlock (ADR-009 §9): all-only (company rows), so the role-scope CHECKs above list them. Accounts
-- move the lock and close; the owner and the admin approve a move back or a reopen (D-06), never their own. In each
-- role's template too (RAD-83). The admin holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'books:lock'), ('accounts', 'books:lock'), ('admin', 'books:unlock'),
  ('owner', 'books:unlock')) AS g(role, permission)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'books:lock'), ('accounts', 'books:lock'), ('admin', 'books:unlock'),
  ('owner', 'books:unlock')) AS g(role, permission)
ON CONFLICT DO NOTHING;
