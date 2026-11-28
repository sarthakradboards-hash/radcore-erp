ALTER TABLE "radcore"."expense_lines" DROP CONSTRAINT "ck_expense_lines_credit_whole";--> statement-breakpoint
ALTER TABLE "radcore"."rcm_rules" ADD COLUMN "withdrawn_from" date;--> statement-breakpoint
ALTER TABLE "radcore"."expense_categories" ADD COLUMN "default_sac" text;--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD COLUMN "sac" text;--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD COLUMN "rcm_cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD COLUMN "rcm_sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD COLUMN "rcm_igst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."rcm_rules" ADD CONSTRAINT "ck_rcm_rules_withdrawn" CHECK ("radcore"."rcm_rules"."withdrawn_from" is null or "radcore"."rcm_rules"."withdrawn_from" > "radcore"."rcm_rules"."effective_from");--> statement-breakpoint
ALTER TABLE "radcore"."expense_categories" ADD CONSTRAINT "ck_expense_categories_default_sac" CHECK ("radcore"."expense_categories"."default_sac" is null or "radcore"."expense_categories"."default_sac" ~ '^[0-9]{4}([0-9]{2}){0,2}$');--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_rcm_cgst" CHECK ("radcore"."expense_lines"."rcm_cgst" >= 0 and "radcore"."expense_lines"."rcm_cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_rcm_sgst" CHECK ("radcore"."expense_lines"."rcm_sgst" >= 0 and "radcore"."expense_lines"."rcm_sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_rcm_igst" CHECK ("radcore"."expense_lines"."rcm_igst" >= 0 and "radcore"."expense_lines"."rcm_igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_sac" CHECK ("radcore"."expense_lines"."sac" is null or "radcore"."expense_lines"."sac" ~ '^[0-9]{4}([0-9]{2}){0,2}$');--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_rcm" CHECK (num_nulls("radcore"."expense_lines"."rcm_cgst", "radcore"."expense_lines"."rcm_sgst", "radcore"."expense_lines"."rcm_igst") in (0, 3) and ("radcore"."expense_lines"."rcm_cgst" is null
    or ("radcore"."expense_lines"."sac" is not null and "radcore"."expense_lines"."cgst" = 0 and "radcore"."expense_lines"."sgst" = 0 and "radcore"."expense_lines"."igst" = 0 and "radcore"."expense_lines"."rcm_cgst" = "radcore"."expense_lines"."rcm_sgst"
      and ("radcore"."expense_lines"."rcm_igst" = 0 or "radcore"."expense_lines"."rcm_cgst" = 0))));--> statement-breakpoint
ALTER TABLE "radcore"."expense_lines" ADD CONSTRAINT "ck_expense_lines_credit_whole" CHECK ("radcore"."expense_lines"."credit_cgst" is null
    or ("radcore"."expense_lines"."credit_reason" is null and "radcore"."expense_lines"."credit_cgst" = coalesce("radcore"."expense_lines"."rcm_cgst", "radcore"."expense_lines"."cgst") and "radcore"."expense_lines"."credit_sgst" = coalesce("radcore"."expense_lines"."rcm_sgst", "radcore"."expense_lines"."sgst")
      and "radcore"."expense_lines"."credit_igst" = coalesce("radcore"."expense_lines"."rcm_igst", "radcore"."expense_lines"."igst"))
    or ("radcore"."expense_lines"."credit_reason" in ('supplier_kind', 'blocked', 'state') and "radcore"."expense_lines"."credit_cgst" = 0 and "radcore"."expense_lines"."credit_sgst" = 0 and "radcore"."expense_lines"."credit_igst" = 0));--> statement-breakpoint
-- RAD-153 PR 2 (ADR-010 §4): an expense line's SAC and the tax it owes under reverse charge, a category's default SAC, and a
-- rule withdrawn from a day (auditor-2 on #431). Kept in the audit trail with the rest of each row.
SELECT radcore.audit_attach('expense_categories', keep => array['name', 'name_key', 'credit', 'blocked_clause', 'active', 'default_tds_section_id',
  'default_sac']);
--> statement-breakpoint
SELECT radcore.audit_attach('expense_lines', keep => array['expense_id', 'line_no', 'category_id', 'account_id', 'description', 'taxable',
  'gst_rate', 'cgst', 'sgst', 'igst', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason', 'tds_section_id', 'sac', 'rcm_cgst', 'rcm_sgst',
  'rcm_igst'], owner => 'expense_id', owner_table => 'expenses');
--> statement-breakpoint
SELECT radcore.audit_attach('rcm_rules', keep => array['prefix', 'supplier', 'effective_from', 'source', 'note', 'confirmed', 'withdrawn_from']);
