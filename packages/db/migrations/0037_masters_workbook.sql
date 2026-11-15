ALTER TABLE "radcore"."exports" ADD COLUMN "format" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."exports" ADD CONSTRAINT "ck_exports_format" CHECK ("radcore"."exports"."format" in ('csv', 'xlsx'));--> statement-breakpoint
-- exports gains format (RAD-92: a list's CSV or a workbook's XLSX), so it's attached again with it kept.
SELECT radcore.audit_attach('exports', keep => array['kind', 'status', 'rows', 'store_key', 'failure', 'format'], redact => array['filter']);
--> statement-breakpoint
-- The masters workbook's key (RAD-92), an ordinary key any role may be granted (Sarthak, 15 Nov). Admin and owner start
-- with it; the built-in templates are what shipped, so they get the same (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES ('admin', 'masters:export', 'all'), ('owner', 'masters:export', 'all');
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE permission = 'masters:export';
