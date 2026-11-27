CREATE TABLE "radcore"."bank_statement_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "radcore"."bank_statement_lines_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"value_date" date NOT NULL,
	"narration" text NOT NULL,
	"reference" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	CONSTRAINT "ck_bank_statement_lines_narration" CHECK (char_length("radcore"."bank_statement_lines"."narration") <= 500),
	CONSTRAINT "ck_bank_statement_lines_reference" CHECK (char_length("radcore"."bank_statement_lines"."reference") <= 100),
	CONSTRAINT "ck_bank_statement_lines_amount" CHECK ("radcore"."bank_statement_lines"."amount" >= 0 and "radcore"."bank_statement_lines"."amount" <> 'NaN'),
	CONSTRAINT "ck_bank_statement_lines_balance" CHECK ("radcore"."bank_statement_lines"."balance" <> 'NaN'),
	CONSTRAINT "ck_bank_statement_lines_direction" CHECK ("radcore"."bank_statement_lines"."direction" in ('in', 'out')),
	CONSTRAINT "ck_bank_statement_lines_above_zero" CHECK ("radcore"."bank_statement_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "radcore"."statement_formats" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"account_id" uuid PRIMARY KEY NOT NULL,
	"date_column" text NOT NULL,
	"narration_column" text NOT NULL,
	"reference_column" text,
	"withdrawal_column" text NOT NULL,
	"deposit_column" text NOT NULL,
	"balance_column" text NOT NULL,
	"newest_first" boolean NOT NULL,
	CONSTRAINT "ck_statement_formats_date_column" CHECK (char_length("radcore"."statement_formats"."date_column") <= 100),
	CONSTRAINT "ck_statement_formats_narration_column" CHECK (char_length("radcore"."statement_formats"."narration_column") <= 100),
	CONSTRAINT "ck_statement_formats_reference_column" CHECK (char_length("radcore"."statement_formats"."reference_column") <= 100),
	CONSTRAINT "ck_statement_formats_withdrawal_column" CHECK (char_length("radcore"."statement_formats"."withdrawal_column") <= 100),
	CONSTRAINT "ck_statement_formats_deposit_column" CHECK (char_length("radcore"."statement_formats"."deposit_column") <= 100),
	CONSTRAINT "ck_statement_formats_balance_column" CHECK (char_length("radcore"."statement_formats"."balance_column") <= 100)
);
--> statement-breakpoint
CREATE TABLE "radcore"."statement_imports" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"new_lines" integer,
	"present_lines" integer,
	"refusals" jsonb,
	CONSTRAINT "ck_statement_imports_status" CHECK ("radcore"."statement_imports"."status" in ('queued', 'imported', 'refused', 'undone')),
	CONSTRAINT "ck_statement_imports_counts" CHECK (("radcore"."statement_imports"."status" in ('imported', 'undone')) = ("radcore"."statement_imports"."new_lines" is not null and "radcore"."statement_imports"."present_lines" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "radcore"."statement_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."statement_formats" ADD CONSTRAINT "statement_formats_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."statement_imports" ADD CONSTRAINT "statement_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."statement_imports" ADD CONSTRAINT "statement_imports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "radcore"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bank_statement_lines_present" ON "radcore"."bank_statement_lines" USING btree ("account_id","value_date","direction","amount","balance","reference");--> statement-breakpoint
CREATE INDEX "ix_bank_statement_lines_account_date" ON "radcore"."bank_statement_lines" USING btree ("account_id","value_date","seq");--> statement-breakpoint
CREATE INDEX "ix_bank_statement_lines_import" ON "radcore"."bank_statement_lines" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_statement_imports_account" ON "radcore"."statement_imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_statement_imports_file" ON "radcore"."statement_imports" USING btree ("file_id");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'bank:read', 'bank:reconcile') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'bank:read', 'bank:reconcile') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- RAD-159 (M5-11; ADR-009 §11): bank statements. A line is stored once and never changed; only undoing its import
-- deletes it. An import changes only its status and counts; a layout is replaced, never deleted.
REVOKE UPDATE, TRUNCATE ON radcore.bank_statement_lines FROM radcore_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.statement_imports, radcore.statement_formats FROM radcore_app;
--> statement-breakpoint
SELECT radcore.audit_attach('statement_formats', keep => array['date_column', 'narration_column', 'reference_column', 'withdrawal_column',
  'deposit_column', 'balance_column', 'newest_first']);
--> statement-breakpoint
-- The refusals and a line's narration quote the bank's file, which the file itself keeps: redacted, not copied into the trail.
SELECT radcore.audit_attach('statement_imports', keep => array['account_id', 'file_id', 'status', 'new_lines', 'present_lines'],
  redact => array['refusals']);
--> statement-breakpoint
SELECT radcore.audit_attach('bank_statement_lines', keep => array['account_id', 'import_id', 'row_no', 'value_date', 'reference', 'direction',
  'amount', 'balance', 'seq'], redact => array['narration']);
--> statement-breakpoint
-- bank:read and bank:reconcile (ADR-009 §9): all-only (company rows), so the role-scope CHECKs above list them. Accounts
-- import and reconcile; the owner sees them. In each role's template too (RAD-83). The admin holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'bank:read'), ('owner', 'bank:read'), ('accounts', 'bank:read'),
  ('admin', 'bank:reconcile'), ('accounts', 'bank:reconcile')) AS g(role, permission)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'bank:read'), ('owner', 'bank:read'), ('accounts', 'bank:read'),
  ('admin', 'bank:reconcile'), ('accounts', 'bank:reconcile')) AS g(role, permission)
ON CONFLICT DO NOTHING;
