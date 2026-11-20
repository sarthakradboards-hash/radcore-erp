CREATE TABLE "radcore"."lead_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"source" text NOT NULL,
	"message" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_lead_enquiries_message" CHECK (char_length("radcore"."lead_enquiries"."message") <= 2000),
	CONSTRAINT "ck_lead_enquiries_source" CHECK ("radcore"."lead_enquiries"."source" in ('manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr'))
);
--> statement-breakpoint
CREATE TABLE "radcore"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"owner" text,
	"follow_up_on" date,
	"last_enquiry_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_leads_name" CHECK (char_length("radcore"."leads"."name") <= 120),
	CONSTRAINT "ck_leads_email" CHECK (char_length("radcore"."leads"."email") <= 254),
	CONSTRAINT "ck_leads_notes" CHECK (char_length("radcore"."leads"."notes") <= 2000),
	CONSTRAINT "ck_leads_phone" CHECK ("radcore"."leads"."phone" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "ck_leads_owner" CHECK ("radcore"."leads"."owner" ~ '^user:[0-9a-f-]{36}$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."lead_enquiries" ADD CONSTRAINT "lead_enquiries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "radcore"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_lead_enquiries_lead" ON "radcore"."lead_enquiries" USING btree ("lead_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_leads_phone" ON "radcore"."leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "ix_leads_owner_follow_up" ON "radcore"."leads" USING btree ("owner","follow_up_on");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c), with a lead's contacts written as [redacted] (RAD-40, M6-16): the trail
-- says a phone or an email changed, never what it was. An enquiry's message is an outsider's words, kept out of the
-- trail too: it's on the enquiry, written once.
SELECT radcore.audit_attach('leads', keep => array['name', 'owner', 'follow_up_on', 'last_enquiry_at', 'notes'],
  redact => array['phone', 'email']);
--> statement-breakpoint
SELECT radcore.audit_attach('lead_enquiries', keep => array['lead_id', 'source', 'received_at'], redact => array['message']);
--> statement-breakpoint
-- Lead and customer records are kept for good (D-12): never deleted.
REVOKE DELETE, TRUNCATE ON radcore.leads, radcore.lead_enquiries FROM radcore_app;
--> statement-breakpoint
-- An enquiry is what the outsider sent, as they sent it (RC-173): written once, never changed.
REVOKE UPDATE ON radcore.lead_enquiries FROM radcore_app;
--> statement-breakpoint
-- RAD-106's keys, ordinary catalogue keys any role can be given. The starting grants, in each role's template too, so a
-- reset keeps them (RAD-83): admin, owner and marketing reach every lead; sales and the counter their own (E7). Who
-- also sees unowned leads is D-11's, with the pipeline (M3-05).
-- leads:contact shows the phone and email of the leads a person may open, so a salesperson can call their own (the
-- architect on RAD-106, as parties:contact): granted at `all` only (RAD-90), to sales, the counter and marketing, and
-- admin, which holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'marketing']) AS r, unnest(array['leads:read', 'leads:write']) AS k
UNION ALL SELECT r, k, 'own' FROM unnest(array['sales', 'counter']) AS r, unnest(array['leads:read', 'leads:write']) AS k
UNION ALL SELECT r, 'leads:contact', 'all' FROM unnest(array['admin', 'sales', 'counter', 'marketing']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission IN ('leads:read', 'leads:write', 'leads:contact')
ON CONFLICT DO NOTHING;
