// The migration runner (RAD-25, ADR-004 §3, RC-052): applies packages/db/migrations forward-only, with the owner
// login, as its own step before the apps start. drizzle-orm's migrator runs every pending migration in one transaction,
// so a failed migration leaves nothing behind. It takes no lock, though, and reads the last applied migration before
// that transaction opens, so this takes a session advisory lock first: a second runner waits, then finds nothing new.
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'migrations');

export async function migrate(url: string, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  const client = new pg.Client({
    connectionString: url,
    application_name: 'radcore-migrate',
    // Rows a migration writes are recorded as this principal (ADR-005 §5). The statement timeout also bounds the wait
    // for the lock below.
    options: '-c app.principal=system:migrate',
    statement_timeout: 15 * 60_000,
  });
  await client.connect();
  try {
    // ADR-002 L3's one exception in this file. lock_timeout is set after the wait, so a second runner queues behind
    // the first instead of failing, while a migration never queues long behind live traffic (ADR-004 §3).
    await client.query("select pg_advisory_lock(hashtextextended('radcore.migrate', 0)); set lock_timeout = '5s'");
    await drizzleMigrate(drizzle({ client }), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  } finally {
    // Closing the session releases the lock.
    await client.end();
  }
}
