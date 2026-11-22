ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'receipts:print') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'receipts:print') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- receipts:print (the architect on RAD-120): print one posted receipt by its id. An ordinary catalogue key, at `all`
-- only (payments isn't a scoped table), with no second factor, for every role that takes money in. Each joins the
-- role's template too, so a reset keeps it (RAD-83). The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'receipts:print', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter', 'sales']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'receipts:print', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'counter', 'sales']) AS r
ON CONFLICT DO NOTHING;
