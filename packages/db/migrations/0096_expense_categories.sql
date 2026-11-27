ALTER TABLE "radcore"."accounts" ADD CONSTRAINT "ux_accounts_id_type_control_kind" UNIQUE("id","type","control_kind");--> statement-breakpoint
CREATE TABLE "radcore"."expense_categories" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"credit" text DEFAULT 'blocked' NOT NULL,
	"blocked_clause" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_expense_categories_name" CHECK (char_length("radcore"."expense_categories"."name") <= 80),
	CONSTRAINT "ck_expense_categories_credit" CHECK ("radcore"."expense_categories"."credit" in ('allowed', 'blocked')),
	CONSTRAINT "ck_expense_categories_clause" CHECK (("radcore"."expense_categories"."credit" = 'blocked') = ("radcore"."expense_categories"."blocked_clause" is not null)
    and ("radcore"."expense_categories"."blocked_clause" is null or "radcore"."expense_categories"."blocked_clause" ~ '^\((a|aa|ab|c|d|e|f|fa|g|h|i)\)$|^\(b\)(\((i|ii|iii)\))?$'))
);
--> statement-breakpoint
CREATE TABLE "radcore"."expense_category_accounts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_type" text DEFAULT 'expense' NOT NULL,
	"account_control_kind" text DEFAULT 'none' NOT NULL,
	CONSTRAINT "pk_expense_category_accounts" PRIMARY KEY("category_id","account_id"),
	CONSTRAINT "ck_expense_category_accounts_ordinary" CHECK ("radcore"."expense_category_accounts"."account_type" = 'expense' and "radcore"."expense_category_accounts"."account_control_kind" = 'none')
);
--> statement-breakpoint
ALTER TABLE "radcore"."expense_category_accounts" ADD CONSTRAINT "expense_category_accounts_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "radcore"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."expense_category_accounts" ADD CONSTRAINT "fk_expense_category_accounts_account" FOREIGN KEY ("account_id","account_type","account_control_kind") REFERENCES "radcore"."accounts"("id","type","control_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_expense_categories_name_key" ON "radcore"."expense_categories" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "ix_expense_category_accounts_account" ON "radcore"."expense_category_accounts" USING btree ("account_id","account_type","account_control_kind");--> statement-breakpoint
-- RAD-152 (ADR-009 §2, §3): expense categories and the ordinary expense accounts each may post to, audited.
SELECT radcore.audit_attach('expense_categories', keep => array['name', 'name_key', 'credit', 'blocked_clause', 'active']);
--> statement-breakpoint
SELECT radcore.audit_attach('expense_category_accounts', keep => array['category_id', 'account_id', 'account_type', 'account_control_kind'],
  owner => 'category_id', owner_table => 'expense_categories');
