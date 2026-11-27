CREATE TABLE "radcore"."rcm_rules" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prefix" text NOT NULL,
	"supplier" text NOT NULL,
	"effective_from" date NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ck_rcm_rules_source" CHECK (char_length("radcore"."rcm_rules"."source") <= 200),
	CONSTRAINT "ck_rcm_rules_note" CHECK (char_length("radcore"."rcm_rules"."note") <= 500),
	CONSTRAINT "ck_rcm_rules_prefix" CHECK ("radcore"."rcm_rules"."prefix" ~ '^[0-9]{2,8}$'),
	CONSTRAINT "ck_rcm_rules_supplier" CHECK ("radcore"."rcm_rules"."supplier" in ('unregistered', 'any', 'not_body_corporate'))
);
--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" DROP CONSTRAINT "ck_purchase_bill_lines_credit_whole";--> statement-breakpoint
ALTER TABLE "radcore"."parties" ADD COLUMN "overseas" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "rcm_cgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "rcm_sgst" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD COLUMN "rcm_igst" numeric(18, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_rcm_rules_prefix_supplier_from" ON "radcore"."rcm_rules" USING btree ("prefix","supplier","effective_from");--> statement-breakpoint
ALTER TABLE "radcore"."parties" ADD CONSTRAINT "ck_parties_overseas" CHECK ("radcore"."parties"."overseas" = ("radcore"."parties"."state_code" = '96') and (not "radcore"."parties"."overseas" or ("radcore"."parties"."gstin" is null and "radcore"."parties"."pan" is null
    and not "radcore"."parties"."composition" and "radcore"."parties"."supplier" and not "radcore"."parties"."customer" and not "radcore"."parties"."dealer" and not "radcore"."parties"."franchisee")));--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_rcm_cgst" CHECK ("radcore"."purchase_bill_lines"."rcm_cgst" >= 0 and "radcore"."purchase_bill_lines"."rcm_cgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_rcm_sgst" CHECK ("radcore"."purchase_bill_lines"."rcm_sgst" >= 0 and "radcore"."purchase_bill_lines"."rcm_sgst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_rcm_igst" CHECK ("radcore"."purchase_bill_lines"."rcm_igst" >= 0 and "radcore"."purchase_bill_lines"."rcm_igst" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_rcm" CHECK (num_nulls("radcore"."purchase_bill_lines"."rcm_cgst", "radcore"."purchase_bill_lines"."rcm_sgst", "radcore"."purchase_bill_lines"."rcm_igst") in (0, 3) and ("radcore"."purchase_bill_lines"."rcm_cgst" is null
    or ("radcore"."purchase_bill_lines"."kind" = 'charge' and "radcore"."purchase_bill_lines"."gst_rate" is not null and "radcore"."purchase_bill_lines"."cgst" = 0 and "radcore"."purchase_bill_lines"."sgst" = 0 and "radcore"."purchase_bill_lines"."igst" = 0
      and "radcore"."purchase_bill_lines"."rcm_cgst" = "radcore"."purchase_bill_lines"."rcm_sgst" and ("radcore"."purchase_bill_lines"."rcm_igst" = 0 or "radcore"."purchase_bill_lines"."rcm_cgst" = 0))));--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bill_lines" ADD CONSTRAINT "ck_purchase_bill_lines_credit_whole" CHECK ("radcore"."purchase_bill_lines"."credit_cgst" is null
    or ("radcore"."purchase_bill_lines"."credit_reason" is null and "radcore"."purchase_bill_lines"."credit_cgst" = coalesce("radcore"."purchase_bill_lines"."rcm_cgst", "radcore"."purchase_bill_lines"."cgst") and "radcore"."purchase_bill_lines"."credit_sgst" = coalesce("radcore"."purchase_bill_lines"."rcm_sgst", "radcore"."purchase_bill_lines"."sgst")
      and "radcore"."purchase_bill_lines"."credit_igst" = coalesce("radcore"."purchase_bill_lines"."rcm_igst", "radcore"."purchase_bill_lines"."igst"))
    or ("radcore"."purchase_bill_lines"."credit_reason" in ('supplier_kind', 'blocked', 'state') and "radcore"."purchase_bill_lines"."credit_cgst" = 0 and "radcore"."purchase_bill_lines"."credit_sgst" = 0 and "radcore"."purchase_bill_lines"."credit_igst" = 0));
--> statement-breakpoint
-- RAD-153 (ADR-010 §4): reverse-charge rules, audited like gst_rates: who added or corrected a rule, from which source, and
-- why. Never deleted: a wrong one is corrected in place, with its reason.
SELECT radcore.audit_attach('rcm_rules', keep => array['prefix', 'supplier', 'effective_from', 'source', 'note', 'confirmed']);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.rcm_rules FROM radcore_app;
--> statement-breakpoint
-- The services CA-06 names, each from GST's start and unconfirmed until the CA signs it (D-08). The rate is GST's own,
-- from gst_rates by SAC.
INSERT INTO radcore.rcm_rules (prefix, supplier, effective_from, source, note) VALUES
  ('996791', 'any', '2017-07-01', 'Notification 13/2017-Central Tax (Rate), entry 1', 'Goods transport agency services (CA-06)'),
  ('99821', 'any', '2017-07-01', 'Notification 13/2017-Central Tax (Rate), entry 2', 'Legal services by an advocate or a firm of advocates (CA-06)'),
  ('998397', 'any', '2017-07-01', 'Notification 13/2017-Central Tax (Rate), entry 4', 'Sponsorship services (CA-06)'),
  ('99852', 'not_body_corporate', '2019-01-01', 'Notification 29/2018-Central Tax (Rate), entry 14', 'Security services by a supplier other than a body corporate (CA-06)');
--> statement-breakpoint
-- ADR-010 §4's accounts (lib-common's SYSTEM_ACCOUNTS): RCM Payable by head, and the credit waiting for its payment.
INSERT INTO radcore.accounts (system_key, name, type, control_kind) VALUES
  ('rcm_credit_pending', 'RCM Credit Pending', 'asset', 'gst'),
  ('rcm_cgst', 'RCM CGST Payable', 'liability', 'gst'),
  ('rcm_sgst', 'RCM SGST Payable', 'liability', 'gst'),
  ('rcm_igst', 'RCM IGST Payable', 'liability', 'gst'),
  ('rcm_cess', 'RCM Cess Payable', 'liability', 'gst');
--> statement-breakpoint
-- Kept in the audit trail with the rest of the party, and of the line.
SELECT radcore.audit_attach('parties',
  keep => array['name', 'customer', 'dealer', 'franchisee', 'supplier', 'gstin', 'pan', 'composition', 'overseas', 'state_code', 'credit_days',
    'credit_limit', 'active', 'system_key'],
  redact => array['phone', 'email', 'address_line1', 'address_line2', 'city', 'pincode']);
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_bill_lines', keep => array['bill_id', 'line_no', 'kind', 'po_line_id', 'receipt_line_id',
  'job_work_receipt_line_id', 'item_id', 'qty', 'rate', 'charge', 'description', 'hsn', 'amount', 'revalued_qty', 'grni_value', 'jwcb_value',
  'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'line_total', 'credit_cgst', 'credit_sgst', 'credit_igst', 'credit_reason',
  'rcm_cgst', 'rcm_sgst', 'rcm_igst'],
  owner => 'bill_id', owner_table => 'purchase_bills');
