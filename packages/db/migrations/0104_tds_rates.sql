CREATE TABLE "radcore"."tds_rates" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"rate_no_pan" numeric(9, 6) NOT NULL,
	"single_limit" numeric(18, 2),
	"yearly_limit" numeric(18, 2),
	"limit_kind" text DEFAULT 'whole' NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ck_tds_rates_rate" CHECK ("radcore"."tds_rates"."rate" between 0 and 100 and "radcore"."tds_rates"."rate" <> 'NaN'),
	CONSTRAINT "ck_tds_rates_rate_no_pan" CHECK ("radcore"."tds_rates"."rate_no_pan" between 0 and 100 and "radcore"."tds_rates"."rate_no_pan" <> 'NaN'),
	CONSTRAINT "ck_tds_rates_single_limit" CHECK ("radcore"."tds_rates"."single_limit" >= 0 and "radcore"."tds_rates"."single_limit" <> 'NaN'),
	CONSTRAINT "ck_tds_rates_yearly_limit" CHECK ("radcore"."tds_rates"."yearly_limit" >= 0 and "radcore"."tds_rates"."yearly_limit" <> 'NaN'),
	CONSTRAINT "ck_tds_rates_source" CHECK (char_length("radcore"."tds_rates"."source") <= 200),
	CONSTRAINT "ck_tds_rates_note" CHECK (char_length("radcore"."tds_rates"."note") <= 500),
	CONSTRAINT "ck_tds_rates_limit_kind" CHECK ("radcore"."tds_rates"."limit_kind" in ('whole', 'excess')),
	CONSTRAINT "ck_tds_rates_excess" CHECK ("radcore"."tds_rates"."limit_kind" = 'whole' or "radcore"."tds_rates"."yearly_limit" is not null),
	CONSTRAINT "ck_tds_rates_no_pan" CHECK ("radcore"."tds_rates"."rate_no_pan" >= "radcore"."tds_rates"."rate")
);
--> statement-breakpoint
CREATE TABLE "radcore"."tds_sections" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"act2025" text NOT NULL,
	"act1961" text NOT NULL,
	"payee" text NOT NULL,
	CONSTRAINT "ck_tds_sections_name" CHECK (char_length("radcore"."tds_sections"."name") <= 120),
	CONSTRAINT "ck_tds_sections_act2025" CHECK (char_length("radcore"."tds_sections"."act2025") <= 40),
	CONSTRAINT "ck_tds_sections_act1961" CHECK (char_length("radcore"."tds_sections"."act1961") <= 40),
	CONSTRAINT "ck_tds_sections_code" CHECK ("radcore"."tds_sections"."code" ~ '^[0-9A-Z][0-9A-Z-]{1,19}$'),
	CONSTRAINT "ck_tds_sections_payee" CHECK ("radcore"."tds_sections"."payee" in ('individual', 'other', 'any'))
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."tds_rates" ADD CONSTRAINT "tds_rates_section_id_tds_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tds_rates_section_from" ON "radcore"."tds_rates" USING btree ("section_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_tds_sections_code" ON "radcore"."tds_sections" USING btree ("code");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- RAD-158 (M5-10; ADR-009 §4, §9): TDS sections and their rates by date, like GST's. Audited; never deleted (a later row
-- supersedes, a wrong one is corrected in place with its reason).
SELECT radcore.audit_attach('tds_sections', keep => array['code', 'name', 'act2025', 'act1961', 'payee']);
--> statement-breakpoint
SELECT radcore.audit_attach('tds_rates', keep => array['section_id', 'effective_from', 'rate', 'rate_no_pan', 'single_limit', 'yearly_limit',
  'limit_kind', 'source', 'note', 'confirmed'], owner => 'section_id', owner_table => 'tds_sections');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON radcore.tds_sections, radcore.tds_rates FROM radcore_app;
--> statement-breakpoint
-- CA-18's payment types, as the 1961 Act's sections stood for 2025-26 after the Finance Act 2025; the Income-tax Act
-- 2025 carries them in section 393 from 1 April 2026. Each is unconfirmed until the CA signs it (D-08). Purchase of
-- goods (194Q) isn't seeded until CA-18 says it applies.
INSERT INTO radcore.tds_sections (code, name, act2025, act1961, payee) VALUES
  ('194C-I', 'Contractors, individual or HUF', '393', '194C', 'individual'),
  ('194C-O', 'Contractors, others', '393', '194C', 'other'),
  ('194J-P', 'Professional fees', '393', '194J', 'any'),
  ('194J-T', 'Technical fees', '393', '194J', 'any'),
  ('194I-B', 'Rent of land or building', '393', '194I', 'any'),
  ('194I-M', 'Rent of plant or machinery', '393', '194I', 'any'),
  ('194H', 'Commission or brokerage', '393', '194H', 'any'),
  ('194A', 'Interest other than on securities', '393', '194A', 'any');
--> statement-breakpoint
INSERT INTO radcore.tds_rates (section_id, effective_from, rate, rate_no_pan, single_limit, yearly_limit, limit_kind, source, note)
SELECT s.id, '2025-04-01', r.rate, '20', r.single, r.yearly, 'whole', 'Finance Act 2025; Income-tax Act 2025 s.393 (CA-18)', r.note
FROM (VALUES
  ('194C-I', 1::numeric, 30000::numeric, 100000::numeric, 'Single bill over 30,000, or the year over 1,00,000'),
  ('194C-O', 2, 30000, 100000, 'Single bill over 30,000, or the year over 1,00,000'),
  ('194J-P', 10, NULL, 50000, 'The year over 50,000'),
  ('194J-T', 2, NULL, 50000, 'The year over 50,000'),
  ('194I-B', 10, 50000, NULL, 'Rent over 50,000 a month, billed by the month (CA-18 confirms)'),
  ('194I-M', 2, 50000, NULL, 'Rent over 50,000 a month, billed by the month (CA-18 confirms)'),
  ('194H', 2, NULL, 20000, 'The year over 20,000'),
  ('194A', 10, NULL, 10000, 'The year over 10,000')
) AS r(code, rate, single, yearly, note) JOIN radcore.tds_sections s ON s.code = r.code;
--> statement-breakpoint
-- The TDS keys (ADR-009 §9): tds:read to admin, owner and accounts; tds:write to the admin alone. Each joins the role's
-- template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'tds:read'), ('owner', 'tds:read'), ('accounts', 'tds:read'),
  ('admin', 'tds:write')) AS g(role, permission)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT g.role, g.permission, 'all' FROM (VALUES ('admin', 'tds:read'), ('owner', 'tds:read'), ('accounts', 'tds:read'),
  ('admin', 'tds:write')) AS g(role, permission)
ON CONFLICT DO NOTHING;
