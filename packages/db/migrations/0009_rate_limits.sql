-- RAD-32 (M1-14, ADR-003): the shared store for rate limits and sign-in lockout. rate-limiter-flexible's own table,
-- made here because the runtime login has no DDL (`tableCreated: true`). It sits in its own schema, like pg-boss's,
-- since it carries no audit columns. Keys are `<prefix>:<key>`; a key that names a person (an email address) is
-- stored as its SHA-256, never as typed. The read-only login gets nothing here.
CREATE SCHEMA "ratelimit";
--> statement-breakpoint
CREATE TABLE "ratelimit"."limits" (
  "key" varchar(255) PRIMARY KEY,
  "points" integer NOT NULL DEFAULT 0,
  "expire" bigint
);
--> statement-breakpoint
GRANT USAGE ON SCHEMA "ratelimit" TO radcore_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ratelimit"."limits" TO radcore_app;
