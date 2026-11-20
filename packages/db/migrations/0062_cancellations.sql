-- RAD-114 PR 1 (M3-10; the architect's ruling): deliveries:cancel and credit_notes:cancel, ordinary catalogue keys any
-- role can be given (Sarthak: dynamic, by owner and admin). The starting grants, in each role's template too (RAD-83):
-- stores and the owner cancel deliveries and returns; accounts and the owner cancel credit notes (their route comes
-- with the credit notes, RAD-114 PR 2). The admin holds every key, as it must to give any role.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'deliveries:cancel', 'all' FROM unnest(array['admin', 'owner', 'stores']) AS r
UNION ALL SELECT r, 'credit_notes:cancel', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'deliveries:cancel', 'all' FROM unnest(array['admin', 'owner', 'stores']) AS r
UNION ALL SELECT r, 'credit_notes:cancel', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
