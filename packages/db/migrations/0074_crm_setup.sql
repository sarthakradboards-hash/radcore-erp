CREATE TABLE "radcore"."ad_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"source_id" uuid,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_ad_spend_amount" CHECK ("radcore"."ad_spend"."amount" >= 0 and "radcore"."ad_spend"."amount" <> 'NaN'),
	CONSTRAINT "ck_ad_spend_note" CHECK (char_length("radcore"."ad_spend"."note") <= 200),
	CONSTRAINT "ck_ad_spend_one" CHECK (("radcore"."ad_spend"."campaign_id" is null) <> ("radcore"."ad_spend"."source_id" is null)),
	CONSTRAINT "ck_ad_spend_range" CHECK ("radcore"."ad_spend"."to_date" >= "radcore"."ad_spend"."from_date"),
	CONSTRAINT "ck_ad_spend_positive" CHECK ("radcore"."ad_spend"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "radcore"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"source_id" uuid NOT NULL,
	"token" text NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "campaigns_token_unique" UNIQUE("token"),
	CONSTRAINT "ck_campaigns_name" CHECK (char_length("radcore"."campaigns"."name") <= 80),
	CONSTRAINT "ck_campaigns_token" CHECK ("radcore"."campaigns"."token" ~ '^[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."lead_set_asides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"campaign_id" uuid,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"message" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_lead_set_asides_name" CHECK (char_length("radcore"."lead_set_asides"."name") <= 120),
	CONSTRAINT "ck_lead_set_asides_email" CHECK (char_length("radcore"."lead_set_asides"."email") <= 254),
	CONSTRAINT "ck_lead_set_asides_message" CHECK (char_length("radcore"."lead_set_asides"."message") <= 2000),
	CONSTRAINT "ck_lead_set_asides_phone" CHECK ("radcore"."lead_set_asides"."phone" ~ '^[+][1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "radcore"."lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"channel" text NOT NULL,
	"door_channel" text,
	"active" boolean DEFAULT true NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "lead_sources_doorChannel_unique" UNIQUE("door_channel"),
	CONSTRAINT "ck_lead_sources_name" CHECK (char_length("radcore"."lead_sources"."name") <= 80),
	CONSTRAINT "ck_lead_sources_channel" CHECK ("radcore"."lead_sources"."channel" in ('manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr')),
	CONSTRAINT "ck_lead_sources_door" CHECK ("radcore"."lead_sources"."door_channel" is null or "radcore"."lead_sources"."door_channel" = "radcore"."lead_sources"."channel"),
	CONSTRAINT "ck_lead_sources_added" CHECK ("radcore"."lead_sources"."door_channel" is not null or "radcore"."lead_sources"."channel" in ('manual', 'walk_in')),
	CONSTRAINT "ck_lead_sources_ignorable" CHECK (not "radcore"."lead_sources"."ignored" or "radcore"."lead_sources"."channel" in ('form', 'meta', 'google', 'whatsapp', 'qr'))
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
-- Nullable while the doors' sources are seeded and existing enquiries take theirs, then NOT NULL (at the end).
ALTER TABLE "radcore"."lead_enquiries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."lead_enquiries" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."ad_spend" ADD CONSTRAINT "ad_spend_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "radcore"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."ad_spend" ADD CONSTRAINT "ad_spend_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "radcore"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."campaigns" ADD CONSTRAINT "campaigns_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "radcore"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."lead_set_asides" ADD CONSTRAINT "lead_set_asides_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "radcore"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."lead_set_asides" ADD CONSTRAINT "lead_set_asides_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "radcore"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ad_spend_campaign" ON "radcore"."ad_spend" USING btree ("campaign_id","from_date");--> statement-breakpoint
CREATE INDEX "ix_ad_spend_source" ON "radcore"."ad_spend" USING btree ("source_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_campaigns_name_key" ON "radcore"."campaigns" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "ix_campaigns_source" ON "radcore"."campaigns" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ix_lead_set_asides_received" ON "radcore"."lead_set_asides" USING btree ("received_at","id");--> statement-breakpoint
CREATE INDEX "ix_lead_set_asides_source" ON "radcore"."lead_set_asides" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ix_lead_set_asides_campaign" ON "radcore"."lead_set_asides" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lead_sources_name_key" ON "radcore"."lead_sources" USING btree ("name_key");--> statement-breakpoint
ALTER TABLE "radcore"."lead_enquiries" ADD CONSTRAINT "lead_enquiries_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "radcore"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."lead_enquiries" ADD CONSTRAINT "lead_enquiries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "radcore"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_lead_enquiries_source" ON "radcore"."lead_enquiries" USING btree ("source_id","received_at");--> statement-breakpoint
CREATE INDEX "ix_lead_enquiries_campaign" ON "radcore"."lead_enquiries" USING btree ("campaign_id","received_at");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- RAD-110 (M3-06, CRM setup; the architect's rulings). Each door's own source, seeded once (door_channel): capture
-- tags every enquiry with its door's, or a live campaign's, or one a person added for capture by hand or at the counter.
INSERT INTO radcore.lead_sources (name, channel, door_channel) VALUES
  ('By hand', 'manual', 'manual'), ('Walk-in', 'walk_in', 'walk_in'), ('Website form', 'form', 'form'), ('Meta', 'meta', 'meta'),
  ('Google', 'google', 'google'), ('WhatsApp', 'whatsapp', 'whatsapp'), ('QR code', 'qr', 'qr');
--> statement-breakpoint
-- Enquiries already taken count under their door's source; then every enquiry has one.
UPDATE radcore.lead_enquiries e SET source_id = s.id FROM radcore.lead_sources s WHERE s.door_channel = e.source;
--> statement-breakpoint
ALTER TABLE radcore.lead_enquiries ALTER COLUMN source_id SET NOT NULL;
--> statement-breakpoint
-- Audited in full, as RAD-109's lists are. A set-aside enquiry's phone, email and message are the outsider's, and
-- personal (RAD-40): the trail says they were written, never what they were. A campaign's link token is redacted as a
-- secret is (v_schema_audit_columns): the trail needn't hold the link.
SELECT radcore.audit_attach('lead_sources', keep => array['name', 'channel', 'door_channel', 'active', 'ignored', 'name_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('campaigns', keep => array['name', 'source_id', 'ended_at', 'name_key'], redact => array['token']);
--> statement-breakpoint
SELECT radcore.audit_attach('ad_spend', keep => array['campaign_id', 'source_id', 'from_date', 'to_date', 'amount', 'note']);
--> statement-breakpoint
SELECT radcore.audit_attach('lead_set_asides', keep => array['source_id', 'campaign_id', 'name', 'received_at'],
  redact => array['phone', 'email', 'message']);
--> statement-breakpoint
-- An enquiry's source and campaign, kept with the rest of it (attached again, as 0056 left it).
SELECT radcore.audit_attach('lead_enquiries', keep => array['lead_id', 'source', 'source_id', 'campaign_id', 'received_at'], redact => array['message']);
--> statement-breakpoint
-- A set-aside enquiry is what the outsider sent, kept as it came (RC-173) and for good (D-12): never changed or deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.lead_set_asides FROM radcore_app;
--> statement-breakpoint
-- campaigns:read and campaigns:write (the architect on RAD-110): all-only, no second factor. The starting grants, in
-- each role's template too (RAD-83): admin, owner and marketing. The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'marketing']) AS r, unnest(array['campaigns:read', 'campaigns:write']) AS k
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'marketing']) AS r, unnest(array['campaigns:read', 'campaigns:write']) AS k
ON CONFLICT DO NOTHING;
