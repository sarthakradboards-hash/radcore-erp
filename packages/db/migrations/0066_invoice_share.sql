-- invoices:share (the architect on RAD-118): send a customer a link to a posted invoice, and revoke one. An ordinary
-- catalogue key, scoped by the invoice's owner, with no second factor. Admin, owner and accounts start with it over
-- every invoice; sales and the counter over their own. Each joins the role's template too, so a reset keeps it (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES
  ('admin', 'invoices:share', 'all'), ('owner', 'invoices:share', 'all'), ('accounts', 'invoices:share', 'all'),
  ('sales', 'invoices:share', 'own'), ('counter', 'invoices:share', 'own')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope) VALUES
  ('admin', 'invoices:share', 'all'), ('owner', 'invoices:share', 'all'), ('accounts', 'invoices:share', 'all'),
  ('sales', 'invoices:share', 'own'), ('counter', 'invoices:share', 'own')
ON CONFLICT DO NOTHING;
