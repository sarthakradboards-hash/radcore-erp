CREATE TABLE "radcore"."tds_deposit_lines" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"deposit_id" uuid NOT NULL,
	"deduction_id" uuid NOT NULL,
	CONSTRAINT "pk_tds_deposit_lines" PRIMARY KEY("deposit_id","deduction_id")
);
--> statement-breakpoint
CREATE TABLE "radcore"."tds_deposits" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"business_date" date NOT NULL,
	"challan_number" text NOT NULL,
	"bsr_code" text NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"posted_entry_id" uuid,
	CONSTRAINT "ck_tds_deposits_challan_number" CHECK (char_length("radcore"."tds_deposits"."challan_number") <= 20),
	CONSTRAINT "ck_tds_deposits_amount" CHECK ("radcore"."tds_deposits"."amount" >= 0 and "radcore"."tds_deposits"."amount" <> 'NaN'),
	CONSTRAINT "ck_tds_deposits_bsr_code" CHECK ("radcore"."tds_deposits"."bsr_code" ~ '^[0-9]{7}$'),
	CONSTRAINT "ck_tds_deposits_challan" CHECK (btrim("radcore"."tds_deposits"."challan_number") <> '')
);
--> statement-breakpoint
ALTER TABLE "radcore"."tds_deposit_lines" ADD CONSTRAINT "tds_deposit_lines_deposit_id_tds_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "radcore"."tds_deposits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deposit_lines" ADD CONSTRAINT "tds_deposit_lines_deduction_id_tds_deductions_id_fk" FOREIGN KEY ("deduction_id") REFERENCES "radcore"."tds_deductions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deposits" ADD CONSTRAINT "tds_deposits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "radcore"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."tds_deposits" ADD CONSTRAINT "tds_deposits_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "radcore"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tds_deposit_lines_deduction" ON "radcore"."tds_deposit_lines" USING btree ("deduction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tds_deposits_number" ON "radcore"."tds_deposits" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ix_tds_deposits_account" ON "radcore"."tds_deposits" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_tds_deposits_entry" ON "radcore"."tds_deposits" USING btree ("posted_entry_id");--> statement-breakpoint
CREATE INDEX "ix_tds_deposits_page" ON "radcore"."tds_deposits" USING btree ("business_date","created_at","id");--> statement-breakpoint
-- RAD-158 PR 3 (ADR-009 §4, F18): TDS deposits pay deductions in full, each once. Audited; posted in one save and never
-- deleted (a challan's correction waits on CA-22, M7).
SELECT radcore.audit_attach('tds_deposits', keep => array['number', 'business_date', 'challan_number', 'bsr_code', 'account_id', 'amount',
  'posted_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('tds_deposit_lines', keep => array['deposit_id', 'deduction_id'], owner => 'deposit_id', owner_table => 'tds_deposits');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.tds_deposits, radcore.tds_deposit_lines FROM radcore_app;
--> statement-breakpoint
REVOKE UPDATE ON radcore.tds_deposit_lines FROM radcore_app;
