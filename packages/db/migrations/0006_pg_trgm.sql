-- RAD-47 (M1-29, RC-160, ADR-005 §7c): pg_trgm, so a list search's ILIKE '%…%' can use a trigram index
-- (columns.ts's trigramIndex). It is a trusted extension, so the owner installs it, in a schema of its own where
-- neither login has USAGE: they can't call its functions by name, and an index scan doesn't need them to. No
-- IF NOT EXISTS, so a copy installed anywhere else fails here loudly.
CREATE SCHEMA radcore_ext;
--> statement-breakpoint
CREATE EXTENSION pg_trgm SCHEMA radcore_ext;
