ALTER TABLE "radcore"."accounts" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "radcore"."accounts" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."accounts" ADD CONSTRAINT "ux_accounts_code" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "radcore"."accounts" ADD CONSTRAINT "ck_accounts_code" CHECK ("radcore"."accounts"."code" ~ '^[0-9A-Z][0-9A-Z.-]{0,11}$');--> statement-breakpoint
ALTER TABLE "radcore"."accounts" ADD CONSTRAINT "ck_accounts_system_active" CHECK ("radcore"."accounts"."system_key" is null or "radcore"."accounts"."active");--> statement-breakpoint
-- The app sets an account's code, and switches it off or on (the architect on RAD-86); still never a system key or
-- a control kind. A system account stays on (ck_accounts_system_active).
GRANT INSERT (code) ON radcore.accounts TO radcore_app;
--> statement-breakpoint
GRANT UPDATE (code, active) ON radcore.accounts TO radcore_app;
--> statement-breakpoint
-- The chart is audited in full, the new columns too.
SELECT radcore.audit_attach('accounts', keep => array['system_key', 'name', 'name_key', 'type', 'control_kind', 'parent_id', 'code', 'active']);
--> statement-breakpoint
-- A line is written with its entry, in the same transaction, never added to a posted one later. Its date is the
-- entry's (the composite foreign key), so the entry's lock check covers it. A switched-off account takes no new
-- postings, but a reversal of an entry already on it and the year-end close (RA009, ADR-006 §2).
CREATE OR REPLACE FUNCTION radcore.guard_journal_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  NEW.posted_at := now();
  IF NOT EXISTS (SELECT 1 FROM radcore.journal_entries e
                 WHERE e.id = NEW.entry_id AND e.tx_id = pg_current_xact_id()::text::bigint) THEN
    RAISE EXCEPTION 'a journal line is written with its entry, never added to a posted one' USING ERRCODE = 'RA001';
  END IF;
  IF NEW.entry_kind <> 'year_close'
     AND EXISTS (SELECT 1 FROM radcore.accounts a WHERE a.id = NEW.account_id AND NOT a.active)
     AND NOT EXISTS (SELECT 1 FROM radcore.journal_entries e WHERE e.id = NEW.entry_id AND e.reverses_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'account % is switched off: only a reversal or the year-end close posts to it', NEW.account_id
      USING ERRCODE = 'RA009';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- accounts:write (RAD-86): codes and switching accounts off and on, for admin, owner and accounts, in each role and its
-- template. It moves no money, so it needs no second factor.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'accounts:write', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'accounts:write', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
