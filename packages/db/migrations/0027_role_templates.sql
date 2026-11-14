CREATE TABLE "radcore"."role_templates" (
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_role_templates" PRIMARY KEY("role","permission"),
	CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own'))
);
--> statement-breakpoint
ALTER TABLE "radcore"."roles" ADD COLUMN "name_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "role_templates_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "radcore"."roles"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_roles_name_key" ON "radcore"."roles" USING btree ("name_key");--> statement-breakpoint
-- Audited like the roles they belong to (ADR-005 §5, §7c). roles gains name_key, so it's attached again.
SELECT radcore.audit_attach('roles', keep => array['name', 'name_key', 'description', 'second_factor_required']);
--> statement-breakpoint
SELECT radcore.audit_attach('role_templates', keep => array['scope']);
--> statement-breakpoint
-- The templates are what shipped: the app reads them and never changes them (the architect on RAD-83).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.role_templates FROM radcore_app;
--> statement-breakpoint
-- The owner manages roles and people too (Sarthak, 14 Nov, from the founder), bounded by the keys owner holds (RAD-36).
INSERT INTO radcore.role_grants (role, permission, scope) VALUES ('owner', 'roles:write', 'all'), ('owner', 'users:write', 'all');
--> statement-breakpoint
-- Each of the plan's 11 roles' template is its grants as shipped, owner's new keys included.
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT role, permission, scope FROM radcore.role_grants WHERE role IN ('owner', 'admin', 'marketing', 'counter', 'sales',
  'stores', 'accounts', 'hr', 'operations', 'technician', 'service_head');
