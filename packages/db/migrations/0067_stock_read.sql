-- stock:read (the architect on RAD-112): see stock on hand, by place, batch and serial. An ordinary catalogue key, with
-- no records and no second factor, for everyone who makes or prices a sale: admin, owner, accounts, stores, counter
-- and sales. Each joins the role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES
  ('admin', 'stock:read', 'all'), ('owner', 'stock:read', 'all'), ('accounts', 'stock:read', 'all'),
  ('stores', 'stock:read', 'all'), ('counter', 'stock:read', 'all'), ('sales', 'stock:read', 'all')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES
  ('admin', 'stock:read', 'all'), ('owner', 'stock:read', 'all'), ('accounts', 'stock:read', 'all'),
  ('stores', 'stock:read', 'all'), ('counter', 'stock:read', 'all'), ('sales', 'stock:read', 'all')
ON CONFLICT DO NOTHING;
