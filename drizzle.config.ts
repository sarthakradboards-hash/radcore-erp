// drizzle-kit's configuration (ADR-005 §8, §10): `npx drizzle-kit generate` writes a migration from the schema, and
// `npx drizzle-kit generate --custom --name <name>` an empty one for hand-written SQL. The partitioned logs' typed
// declarations stay outside these globs, so generate leaves them alone.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['packages/db/src/columns.ts', 'packages/db/src/*/tables.ts', 'packages/db/views/index.ts'],
  out: 'packages/db/migrations',
  casing: 'snake_case',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
