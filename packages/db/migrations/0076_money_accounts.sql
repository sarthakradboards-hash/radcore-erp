ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
-- money_accounts:read (RAD-116, the architect's ruling): the accounts a payment may name, for a screen's picker. An
-- ordinary catalogue key any role can be given, at `all` only, in each role's template too (RAD-83): those who take
-- or record money. The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'money_accounts:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'money_accounts:read', 'all' FROM unnest(array['admin', 'owner', 'accounts', 'sales', 'counter']) AS r
ON CONFLICT DO NOTHING;
