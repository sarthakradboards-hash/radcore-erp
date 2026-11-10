-- RAD-24 (M1-06, ADR-005 §7c, RC-003, RC-193): what the runtime login radcore_app and the read-only login radcore_read
-- may do. The logins exist before this runs (tools/db-logins.ts), and the owner login radcore_owner runs it.
-- Neither login owns anything, so neither can alter or drop it, and neither gets CREATE anywhere.
-- An append-only table's migration revokes UPDATE, DELETE and TRUNCATE from radcore_app (audit_log and access_log
-- INSERT too), a view's revokes INSERT, UPDATE and DELETE, and every partition gets REVOKE ALL from both logins;
-- tools/logins.test.ts fails on one that doesn't.

-- No temporary tables (ADR-005 §7c), and only the two logins may connect besides the owner.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO radcore_app, radcore_read', current_database());
END
$$;
--> statement-breakpoint
-- No function is callable by default; one the app needs is granted by name.
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA radcore TO radcore_app, radcore_read;
--> statement-breakpoint
-- The views 0000 made: read only.
GRANT SELECT ON ALL TABLES IN SCHEMA radcore TO radcore_app, radcore_read;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA radcore
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO radcore_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA radcore GRANT SELECT ON TABLES TO radcore_read;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA radcore GRANT USAGE, SELECT ON SEQUENCES TO radcore_app;
--> statement-breakpoint
-- pg-boss's queue (ADR-002 §4): the worker reads and writes its rows. radcore_read gets none of it.
GRANT USAGE ON SCHEMA pgboss TO radcore_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO radcore_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO radcore_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO radcore_app;
--> statement-breakpoint
-- A later pg-boss migration's tables, the same.
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO radcore_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO radcore_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner IN SCHEMA pgboss GRANT EXECUTE ON FUNCTIONS TO radcore_app;
