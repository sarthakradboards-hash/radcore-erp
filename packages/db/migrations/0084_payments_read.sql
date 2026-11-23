ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- payments:read (RAD-116, for RAD-126): receipts, payments and refunds as a list and one by one. An ordinary catalogue
-- key, at `all` only (payments isn't a scoped table, as receipts:print), with no second factor, for the roles that
-- record them. Each joins the role's template too, so a reset keeps it (RAD-83). The admin holds every key.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'payments:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'payments:read', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
