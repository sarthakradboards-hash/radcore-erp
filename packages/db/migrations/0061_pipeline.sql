CREATE TABLE "radcore"."follow_up_plan_steps" (
	"plan_id" uuid NOT NULL,
	"step" smallint NOT NULL,
	"after_days" smallint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "follow_up_plan_steps_plan_id_step_pk" PRIMARY KEY("plan_id","step"),
	CONSTRAINT "ck_follow_up_plan_steps_note" CHECK (char_length("radcore"."follow_up_plan_steps"."note") <= 200),
	CONSTRAINT "ck_follow_up_plan_steps_step" CHECK ("radcore"."follow_up_plan_steps"."step" between 1 and 20),
	CONSTRAINT "ck_follow_up_plan_steps_after_days" CHECK ("radcore"."follow_up_plan_steps"."after_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "radcore"."follow_up_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_follow_up_plans_name" CHECK (char_length("radcore"."follow_up_plans"."name") <= 60)
);
--> statement-breakpoint
CREATE TABLE "radcore"."lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stage" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_lead_activities_note" CHECK (char_length("radcore"."lead_activities"."note") <= 2000),
	CONSTRAINT "ck_lead_activities_kind" CHECK ("radcore"."lead_activities"."kind" in ('follow_up', 'quick_reply', 'stage')),
	CONSTRAINT "ck_lead_activities_stage" CHECK (("radcore"."lead_activities"."kind" = 'stage') = ("radcore"."lead_activities"."stage" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."lead_lost_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"label_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_lead_lost_reasons_label" CHECK (char_length("radcore"."lead_lost_reasons"."label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "radcore"."quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"title_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_quick_replies_title" CHECK (char_length("radcore"."quick_replies"."title") <= 60),
	CONSTRAINT "ck_quick_replies_body" CHECK (char_length("radcore"."quick_replies"."body") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "stage" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "lost_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "score" smallint;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "plan_step" smallint;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD COLUMN "follow_up_told_on" date;--> statement-breakpoint
ALTER TABLE "radcore"."follow_up_plan_steps" ADD CONSTRAINT "follow_up_plan_steps_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "radcore"."follow_up_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "radcore"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_follow_up_plans_name_key" ON "radcore"."follow_up_plans" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "ix_lead_activities_lead" ON "radcore"."lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_lead_lost_reasons_label_key" ON "radcore"."lead_lost_reasons" USING btree ("label_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_quick_replies_title_key" ON "radcore"."quick_replies" USING btree ("title_key");--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "leads_lost_reason_id_lead_lost_reasons_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "radcore"."lead_lost_reasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "leads_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "radcore"."follow_up_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_leads_lost_reason" ON "radcore"."leads" USING btree ("lost_reason_id");--> statement-breakpoint
CREATE INDEX "ix_leads_plan" ON "radcore"."leads" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "ck_leads_value" CHECK ("radcore"."leads"."value" >= 0 and "radcore"."leads"."value" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "ck_leads_stage" CHECK ("radcore"."leads"."stage" in ('new', 'contacted', 'interested', 'meeting_booked', 'converted', 'lost'));--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "ck_leads_lost_with_reason" CHECK (("radcore"."leads"."stage" = 'lost') = ("radcore"."leads"."lost_reason_id" is not null));--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "ck_leads_score" CHECK ("radcore"."leads"."score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "radcore"."leads" ADD CONSTRAINT "ck_leads_plan_whole" CHECK (("radcore"."leads"."plan_id" is null) = ("radcore"."leads"."plan_step" is null));--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c): leads again with the pipeline's columns, its contacts still [redacted].
SELECT radcore.audit_attach('leads', keep => array['name', 'owner', 'follow_up_on', 'last_enquiry_at', 'notes', 'stage',
  'lost_reason_id', 'value', 'score', 'plan_id', 'plan_step', 'follow_up_told_on'], redact => array['phone', 'email']);
--> statement-breakpoint
SELECT radcore.audit_attach('lead_activities', keep => array['lead_id', 'kind', 'stage', 'note']);
--> statement-breakpoint
SELECT radcore.audit_attach('lead_lost_reasons', keep => array['label', 'active', 'label_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('follow_up_plans', keep => array['name', 'active', 'name_key']);
--> statement-breakpoint
SELECT radcore.audit_attach('follow_up_plan_steps', keep => array['after_days', 'note']);
--> statement-breakpoint
SELECT radcore.audit_attach('quick_replies', keep => array['title', 'body', 'active', 'title_key']);
--> statement-breakpoint
-- A lead's timeline is what was done, written once: never changed, and kept with the lead for good (D-12).
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.lead_activities FROM radcore_app;
--> statement-breakpoint
-- The CRM's lists: an item a lead may name is switched off, never deleted. A plan's steps are rewritten with the plan.
REVOKE DELETE, TRUNCATE ON radcore.lead_lost_reasons, radcore.follow_up_plans, radcore.quick_replies FROM radcore_app;
--> statement-breakpoint
-- Their starting items (the architect on RAD-109), which leads:setup changes as the team works.
INSERT INTO radcore.lead_lost_reasons (label)
SELECT unnest(array['Price', 'Bought elsewhere', 'Not reachable', 'Not interested']);
--> statement-breakpoint
WITH plan AS (INSERT INTO radcore.follow_up_plans (name) VALUES ('New enquiry') RETURNING id)
INSERT INTO radcore.follow_up_plan_steps (plan_id, step, after_days)
SELECT plan.id, s.step, s.after_days FROM plan, unnest(array[1, 2, 3, 4], array[1, 2, 4, 7]) AS s(step, after_days);
--> statement-breakpoint
INSERT INTO radcore.quick_replies (title, body)
VALUES ('Thanks for your enquiry', 'Hi, thanks for your enquiry. When would be a good time to talk?');
--> statement-breakpoint
-- D-11 (Sarthak, 20 Nov; the architect on RAD-109): leads:unassigned, all-only, starts with sales and the counter, who
-- hold leads:read and leads:write at `own`, and admin, which holds every key. leads:setup starts with admin, owner and
-- marketing. In each role's template too, so a reset keeps them (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'leads:unassigned', 'all' FROM unnest(array['admin', 'sales', 'counter']) AS r
UNION ALL SELECT r, 'leads:setup', 'all' FROM unnest(array['admin', 'owner', 'marketing']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission IN ('leads:unassigned', 'leads:setup')
ON CONFLICT DO NOTHING;
