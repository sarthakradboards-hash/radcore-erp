CREATE TABLE "radcore"."bank_match_journal_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"match_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL,
	CONSTRAINT "pk_bank_match_journal_lines" PRIMARY KEY("match_id","journal_line_id")
);
--> statement-breakpoint
CREATE TABLE "radcore"."bank_match_statement_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"match_id" uuid NOT NULL,
	"statement_line_id" uuid NOT NULL,
	CONSTRAINT "pk_bank_match_statement_lines" PRIMARY KEY("match_id","statement_line_id")
);
--> statement-breakpoint
CREATE TABLE "radcore"."bank_matches" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"unmatched_at" timestamp with time zone,
	"unmatch_reason" text,
	CONSTRAINT "ck_bank_matches_unmatch_reason" CHECK (char_length("radcore"."bank_matches"."unmatch_reason") <= 500),
	CONSTRAINT "ck_bank_matches_kind" CHECK ("radcore"."bank_matches"."kind" in ('manual', 'auto')),
	CONSTRAINT "ck_bank_matches_unmatched" CHECK (("radcore"."bank_matches"."unmatched_at" is null) = ("radcore"."bank_matches"."unmatch_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."bank_match_journal_lines" ADD CONSTRAINT "bank_match_journal_lines_match_id_bank_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "radcore"."bank_matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."bank_match_journal_lines" ADD CONSTRAINT "bank_match_journal_lines_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "radcore"."journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."bank_match_statement_lines" ADD CONSTRAINT "bank_match_statement_lines_match_id_bank_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "radcore"."bank_matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."bank_match_statement_lines" ADD CONSTRAINT "fk_bank_match_statement_lines_line" FOREIGN KEY ("statement_line_id") REFERENCES "radcore"."bank_statement_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."bank_matches" ADD CONSTRAINT "bank_matches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bank_match_journal_lines_line" ON "radcore"."bank_match_journal_lines" USING btree ("journal_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bank_match_statement_lines_line" ON "radcore"."bank_match_statement_lines" USING btree ("statement_line_id");--> statement-breakpoint
CREATE INDEX "ix_bank_matches_account" ON "radcore"."bank_matches" USING btree ("account_id");--> statement-breakpoint
-- RAD-165 (M5-13; ADR-009 §12; RC-145, RC-210): a match, checked at commit, so a save may add both its sides (and, with
-- a bank charge, the charge's entry) before the check: both sides on the match's bank account, no entry reversed or a
-- reversal, and the statement side's signed total (in less out) equal to the books' (debit less credit).
CREATE FUNCTION radcore.check_bank_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  m radcore.bank_matches%ROWTYPE;
  bank numeric;
  books numeric;
BEGIN
  SELECT * INTO m FROM radcore.bank_matches WHERE id = NEW.match_id;
  IF m.unmatched_at IS NOT NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM radcore.bank_match_statement_lines x JOIN radcore.bank_statement_lines s ON s.id = x.statement_line_id
             WHERE x.match_id = m.id AND s.account_id <> m.account_id)
     OR EXISTS (SELECT 1 FROM radcore.bank_match_journal_lines x JOIN radcore.journal_lines l ON l.id = x.journal_line_id
                WHERE x.match_id = m.id AND l.account_id <> m.account_id) THEN
    RAISE EXCEPTION 'a match joins lines of its own bank account only' USING ERRCODE = 'RA006', CONSTRAINT = 'match_other_account';
  END IF;
  IF EXISTS (SELECT 1 FROM radcore.bank_match_journal_lines x JOIN radcore.journal_lines l ON l.id = x.journal_line_id
             JOIN radcore.journal_entries e ON e.id = l.entry_id
             WHERE x.match_id = m.id AND (e.reverses_entry_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM radcore.journal_entries r WHERE r.reverses_entry_id = e.id))) THEN
    RAISE EXCEPTION 'a match takes only a live entry, neither reversed nor a reversal'
      USING ERRCODE = 'RA006', CONSTRAINT = 'match_entry_reversed';
  END IF;
  SELECT coalesce(sum(CASE s.direction WHEN 'in' THEN s.amount ELSE -s.amount END), 0) INTO bank
    FROM radcore.bank_match_statement_lines x JOIN radcore.bank_statement_lines s ON s.id = x.statement_line_id WHERE x.match_id = m.id;
  SELECT coalesce(sum(l.debit - l.credit), 0) INTO books
    FROM radcore.bank_match_journal_lines x JOIN radcore.journal_lines l ON l.id = x.journal_line_id WHERE x.match_id = m.id;
  IF bank <> books
     OR NOT EXISTS (SELECT 1 FROM radcore.bank_match_statement_lines WHERE match_id = m.id)
     OR NOT EXISTS (SELECT 1 FROM radcore.bank_match_journal_lines WHERE match_id = m.id) THEN
    RAISE EXCEPTION 'match %: the statement lines come to %, the book lines to %', m.id, bank, books
      USING ERRCODE = 'RA006', CONSTRAINT = 'match_unbalanced';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_bank_match AFTER INSERT ON radcore.bank_match_statement_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION radcore.check_bank_match();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_bank_match AFTER INSERT ON radcore.bank_match_journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION radcore.check_bank_match();
--> statement-breakpoint
-- A matched entry isn't reversed (ADR-009 §12, `bank_matched`): its document's cancel says so first, by name; this is the
-- backstop for any other path. Unmatch first.
CREATE FUNCTION radcore.guard_matched_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM radcore.journal_lines l
       JOIN radcore.bank_match_journal_lines x ON x.journal_line_id = l.id WHERE l.entry_id = NEW.reverses_entry_id) THEN
    RAISE EXCEPTION 'entry % is matched to the bank statement: unmatch it first', NEW.reverses_entry_id
      USING ERRCODE = 'RA006', CONSTRAINT = 'bank_matched';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_matched_reversal BEFORE INSERT ON radcore.journal_entries FOR EACH ROW EXECUTE FUNCTION radcore.guard_matched_reversal();
--> statement-breakpoint
-- A match is written once; unmatching stamps it and deletes its links. The links are never changed.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.bank_matches FROM radcore_app;
--> statement-breakpoint
GRANT UPDATE (unmatched_at, unmatch_reason) ON radcore.bank_matches TO radcore_app;
--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON radcore.bank_match_statement_lines, radcore.bank_match_journal_lines FROM radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('bank_matches', keep => array['account_id', 'kind', 'unmatched_at', 'unmatch_reason']);
--> statement-breakpoint
SELECT radcore.audit_attach('bank_match_statement_lines', keep => array['match_id', 'statement_line_id'], owner => 'match_id',
  owner_table => 'bank_matches');
--> statement-breakpoint
SELECT radcore.audit_attach('bank_match_journal_lines', keep => array['match_id', 'journal_line_id'], owner => 'match_id',
  owner_table => 'bank_matches');
--> statement-breakpoint
-- A match locks its statement lines FOR UPDATE (ADR-009 §12), and a row lock needs UPDATE on a column: so UPDATE on `id`
-- alone, and a line is still never changed, which refuse_change holds (RA001). Undo still deletes them.
CREATE TRIGGER refuse_change BEFORE UPDATE ON radcore.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
GRANT UPDATE (id) ON radcore.bank_statement_lines TO radcore_app;
