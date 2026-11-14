CREATE TABLE "radcore"."role_grants" (
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "pk_role_grants" PRIMARY KEY("role","permission"),
	CONSTRAINT "ck_role_grants_permission" CHECK ("radcore"."role_grants"."permission" ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'),
	CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own'))
);
--> statement-breakpoint
CREATE TABLE "radcore"."roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"second_factor_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ck_roles_name" CHECK (char_length("radcore"."roles"."name") <= 60),
	CONSTRAINT "ck_roles_description" CHECK (char_length("radcore"."roles"."description") <= 500),
	CONSTRAINT "ck_roles_key" CHECK ("radcore"."roles"."key" ~ '^[a-z][a-z_]{1,31}$')
);
--> statement-breakpoint
ALTER TABLE "radcore"."users" ADD COLUMN "role" text NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."users" ADD COLUMN "role_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "role_grants_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "radcore"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "radcore"."roles"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_users_role" ON "radcore"."users" USING btree ("role");--> statement-breakpoint
-- Records people change: audited, with the who-and-when stamp (ADR-005 §5, §7c). A role's grants and a person's
-- role are the trail RC-033 and RC-095 ask for. The users table gains `role` and `role_since`, so it's attached again.
SELECT radcore.audit_attach('roles', keep => array['name', 'description', 'second_factor_required']);
--> statement-breakpoint
SELECT radcore.audit_attach('role_grants', keep => array['scope']);
--> statement-breakpoint
SELECT radcore.audit_attach('users', keep => array['status', 'password_set_at', 'role', 'role_since'],
  redact => array['email', 'email_key', 'display_name', 'password_hash']);
--> statement-breakpoint
-- The plan's 11 roles (page 4), one per person. `counter` is the plan's Store, the counter staff, shown as "Counter
-- (store)": a key one letter from `stores` was v1's defect RC-044 (the architect on RAD-35). D-19 asks the second factor of owner, admin, accounts and HR.
INSERT INTO radcore.roles (key, name, description, second_factor_required) VALUES
  ('owner', 'Owner', 'The founder: every dashboard, reads every section, approves; creates no day-to-day documents and manages no users', true),
  ('admin', 'Admin', 'Whoever sets up the system: masters, price lists, users and roles, permissions, settings, the audit trail; holds every permission', true),
  ('marketing', 'Marketing', 'Lead sources, campaign links and QR codes, ad spend, the marketing dashboard; reads and edits leads', false),
  ('counter', 'Counter (store)', 'Counter staff at the store: walk-ins, the quick bill, repeat-customer lookup, sharing invoices', false),
  ('sales', 'Sales', 'Pipeline and follow-ups, quotes and dealer orders, bookings with an advance, the sales dashboard', false),
  ('stores', 'Stores', 'Whoever receives and issues goods: purchase orders, inward and QC, transfers, counts and adjustments, imports', false),
  ('accounts', 'Accounts', 'Whoever runs the books: bills, payments, expenses, the books and reports, bank reconciliation, GST, payroll', true),
  ('hr', 'HR', 'People matters: openings and applicants, employees, attendance and leave, preparing payroll', true),
  ('operations', 'Operations', 'Whoever runs the floor and machines: projects, tasks, routines, assets and maintenance, job work', false),
  ('technician', 'Technician', 'Workshop staff: job cards, diagnosis, fitting parts, photos', false),
  ('service_head', 'Service manager', 'Head of the workshop: what a technician does, plus estimates, warranty claims and the service reports', false);
--> statement-breakpoint
-- The M1 grants (RAD-35): every person has My work's session:read; admin holds every M1 key, each as its own row, never a
-- wildcard; owner reads the audit trail, personal data and pay (D-20: only admin and owner see pay); the rest follow
-- each role's plan column, as far as M1 keys exist. Each module's migration adds its own keys to the roles it names.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r.key, 'session:read', 'all' FROM radcore.roles r
UNION ALL
SELECT 'admin', k, 'all' FROM unnest(array['users:read', 'users:write', 'roles:read', 'roles:write', 'audit:read', 'pii:read', 'pay:read',
  'photo_files:read', 'photo_files:write', 'resume_files:read', 'resume_files:write', 'statement_files:read',
  'statement_files:write', 'import_files:read', 'import_files:write']) AS k
UNION ALL
SELECT 'owner', k, 'all' FROM unnest(array['audit:read', 'pii:read', 'pay:read']) AS k
UNION ALL
SELECT r, k, 'all' FROM unnest(array['technician', 'service_head']) AS r, unnest(array['photo_files:read', 'photo_files:write']) AS k
UNION ALL
SELECT 'hr', k, 'all' FROM unnest(array['resume_files:read', 'resume_files:write']) AS k
UNION ALL
SELECT 'accounts', k, 'all' FROM unnest(array['statement_files:read', 'statement_files:write']) AS k
UNION ALL
SELECT r, k, 'all' FROM unnest(array['stores', 'accounts']) AS r, unnest(array['import_files:read', 'import_files:write']) AS k;
