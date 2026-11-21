CREATE TABLE "radcore"."party_managers" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_party_managers_owner" CHECK ("radcore"."party_managers"."owner" ~ '^user:[0-9a-f-]{36}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"as_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outstanding" numeric(18, 2) NOT NULL,
	"overdue" numeric(18, 2) NOT NULL,
	"oldest_due" date,
	"channel" text NOT NULL,
	"note" text,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_payment_reminders_outstanding" CHECK ("radcore"."payment_reminders"."outstanding" <> 'NaN'),
	CONSTRAINT "ck_payment_reminders_overdue" CHECK ("radcore"."payment_reminders"."overdue" >= 0 and "radcore"."payment_reminders"."overdue" <> 'NaN'),
	CONSTRAINT "ck_payment_reminders_note" CHECK (char_length("radcore"."payment_reminders"."note") <= 500),
	CONSTRAINT "ck_payment_reminders_channel" CHECK ("radcore"."payment_reminders"."channel" in ('whatsapp', 'phone', 'email', 'in_person'))
);
--> statement-breakpoint
ALTER TABLE "radcore"."party_managers" ADD CONSTRAINT "party_managers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payment_reminders" ADD CONSTRAINT "payment_reminders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "radcore"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_payment_reminders_party" ON "radcore"."payment_reminders" USING btree ("party_id","as_at");--> statement-breakpoint
CREATE VIEW "radcore"."v_sales_document_refs" AS (select 'invoices'::text as document_table, i.id as document_id, i.number, i.business_date
  from radcore.invoices i where i.status <> 'draft'
  union all
  select 'credit_notes'::text, c.id, c.number, c.business_date from radcore.credit_notes c where c.status <> 'draft');--> statement-breakpoint
-- RAD-119 (M3-15): reminders are append-only (ADR-005 §7, the architect's ruling), audited in full.
SELECT radcore.audit_attach('payment_reminders', keep => array['party_id', 'as_at', 'outstanding', 'overdue', 'oldest_due', 'channel',
  'note', 'link_id']);
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.payment_reminders FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.payment_reminders FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.payment_reminders FROM radcore_app;
--> statement-breakpoint
-- RAD-119's keys, dynamic catalogue keys like any other: receivables:read and receivables:remind for admin, owner and
-- accounts (the architect's ruling). Each joins the role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES
  ('admin', 'receivables:read', 'all'), ('admin', 'receivables:remind', 'all'),
  ('owner', 'receivables:read', 'all'), ('owner', 'receivables:remind', 'all'),
  ('accounts', 'receivables:read', 'all'), ('accounts', 'receivables:remind', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES
  ('admin', 'receivables:read', 'all'), ('admin', 'receivables:remind', 'all'),
  ('owner', 'receivables:read', 'all'), ('owner', 'receivables:remind', 'all'),
  ('accounts', 'receivables:read', 'all'), ('accounts', 'receivables:remind', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_sales_document_refs FROM radcore_app;
--> statement-breakpoint
-- Who manages a party (RAD-119, the architect's ruling) is audited: set and cleared under parties:manage.
SELECT radcore.audit_attach('party_managers', keep => array['party_id', 'owner']);
