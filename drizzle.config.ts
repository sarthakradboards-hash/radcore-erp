// drizzle-kit's configuration (ADR-005 §8, §10): `npx drizzle-kit generate` writes a migration from the schema, and
// `npx drizzle-kit generate --custom --name <name>` an empty one for hand-written SQL. The partitioned logs' typed
// declarations stay outside these globs, so generate leaves them alone.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // Every file eslint.config.mjs's TABLE_FILES names, by name (tools/eslint-config.test.ts holds the two equal), and the views.
  schema: ['packages/db/src/columns.ts', 'packages/db/src/*/tables.ts', 'packages/db/src/platform/tables-sign-in.ts', 'packages/db/src/sales/tables-credit.ts',
    'packages/db/views/index.ts'],
  out: 'packages/db/migrations',
  casing: 'snake_case',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
