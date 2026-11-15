CREATE TABLE "radcore"."gst_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hsn" text NOT NULL,
	"effective_from" date NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_gst_rates_rate" CHECK ("radcore"."gst_rates"."rate" between 0 and 100 and "radcore"."gst_rates"."rate" <> 'NaN'),
	CONSTRAINT "ck_gst_rates_source" CHECK (char_length("radcore"."gst_rates"."source") <= 200),
	CONSTRAINT "ck_gst_rates_note" CHECK (char_length("radcore"."gst_rates"."note") <= 500),
	CONSTRAINT "ck_gst_rates_hsn" CHECK ("radcore"."gst_rates"."hsn" ~ '^[0-9]{2}([0-9]{2}){0,3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_gst_rates_hsn_from" ON "radcore"."gst_rates" USING btree ("hsn","effective_from");
--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c): who added or corrected a rate, from which notification, and why (RAD-91).
SELECT radcore.audit_attach('gst_rates', keep => array['hsn', 'effective_from', 'rate', 'source', 'note']);
--> statement-breakpoint
-- A rate is never deleted: a later one supersedes it, and a wrong one is corrected in place, with its reason.
REVOKE DELETE, TRUNCATE ON radcore.gst_rates FROM radcore_app;
--> statement-breakpoint
-- The GST keys (RAD-91), ordinary catalogue keys any role can be given (Sarthak: dynamic). The starting grants, in
-- each role's template too (RAD-83). The table starts empty: its rows come from the official notifications, as the
-- CA confirms them (CA-34).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'gst:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'gst:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'gst:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
UNION ALL SELECT r, 'gst:write', 'all' FROM unnest(array['admin', 'accounts']) AS r
ON CONFLICT DO NOTHING;
