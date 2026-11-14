-- RAD-83 (Sarthak, 14 Nov): owner edits roles and assigns people, so owner sees them too. 0027 gave owner roles:write
-- and users:write without the matching reads, and the role and people screens answered 403 (e2e-playwright on RAD-83).
-- Owner's template gains them as well, so a reset keeps them.
INSERT INTO radcore.role_grants (role, permission, scope) VALUES ('owner', 'roles:read', 'all'), ('owner', 'users:read', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES ('owner', 'roles:read', 'all'), ('owner', 'users:read', 'all')
ON CONFLICT DO NOTHING;
