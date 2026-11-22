CREATE TABLE "radcore"."quick_bill_holds" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"payments" json NOT NULL,
	"picks" json NOT NULL,
	"approved_after" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_quick_bill_holds_approved_after" CHECK ("radcore"."quick_bill_holds"."approved_after" <> 'NaN')
);
--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."quick_bill_holds" ADD CONSTRAINT "quick_bill_holds_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "radcore"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."quick_bill_holds" ADD CONSTRAINT "quick_bill_holds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "radcore"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_quick_bill_holds_location" ON "radcore"."quick_bill_holds" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- Audited like every table (ADR-005 §5, §7c).
SELECT radcore.audit_attach('quick_bill_holds', keep => array['order_id', 'location_id', 'payments', 'picks', 'approved_after']);
--> statement-breakpoint
-- sales:counter_credit (RAD-115, the architect's re-ruling on Sarthak's "Allow with approval"): who may ask to leave a
-- balance on a counter sale; sales:override approves it. An ordinary catalogue key any role can be given, in each role's
-- template too (RAD-83): the counter and sales ask. The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'sales:counter_credit', 'all' FROM unnest(array['admin', 'counter', 'sales']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'sales:counter_credit', 'all' FROM unnest(array['admin', 'counter', 'sales']) AS r
ON CONFLICT DO NOTHING;
