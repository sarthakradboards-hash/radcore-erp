// The migration runner (RAD-25, ADR-004 §3, RC-052): applies packages/db/migrations forward-only, with the owner
// login, as its own step before the apps start. drizzle-orm's migrator runs every pending migration in one transaction,
// so a failed migration leaves nothing behind. It takes no lock, though, and reads the last applied migration before
// that transaction opens, so this takes a session advisory lock first, on the same client drizzle then runs on.
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'migrations');
// The advisory lock's key, hashed by hashtextextended(key, 0). The partition top-up takes the same lock (ADR-005 §8).
export const MIGRATION_LOCK_KEY = 'radcore.migrate';
/** The future months each log keeps a partition for, after every deploy's top-up (ADR-005 §8). */
export const LOG_MONTHS_AHEAD = 12;

/**
 * Applies the migrations, then tops up the log partitions under the same lock (ADR-005 §8). A test that migrates a
 * partial copy of the folder, which may stop before the partitions' function exists, passes `topUp: false`.
 */
export async function migrate(url: string, { migrationsFolder = MIGRATIONS_FOLDER, topUp = true } = {}): Promise<void> {
  const client = new pg.Client({
    connectionString: url,
    application_name: 'radcore-migrate',
    // A second runner waits 5 s for the lock below, then fails (CI serialises deploys, ADR-004 §3), and a migration
    // never queues long behind live traffic.
    lock_timeout: 5_000,
    statement_timeout: 15 * 60_000,
  });
  await client.connect();
  try {
    // Rows a migration writes are recorded as this principal (ADR-005 §5). Set on the session, not in the connection's
    // options: a URL with its own `?options=` (the test setup's `-c role=radcore_owner`, RAD-24) replaces those
    // outright, and the principal was lost (RAD-82). A session setting holds through drizzle's transaction.
    await client.query("select set_config('app.principal', 'system:migrate', false)");
    try {
      // ADR-002 L3's exceptions in this file: this lock, and the partition top-up below.
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_KEY]);
    } catch (error) {
      // 55P03 lock_not_available: lock_timeout ran out.
      if ((error as { code?: string }).code === '55P03') {
        throw new Error('another migration is running: the radcore.migrate lock was still held after 5 s', { cause: error });
      }
      throw error;
    }
    await drizzleMigrate(drizzle({ client }), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
    // ADR-005 §8: the partition top-up, on every deploy and in the test setup, under the same lock. It's idempotent,
    // and keeps LOG_MONTHS_AHEAD future months for each log.
    if (topUp) {
      await client.query('select radcore.add_log_partitions($1)', [LOG_MONTHS_AHEAD]);
    }
  } finally {
    // Closing the session releases the lock.
    await client.end();
  }
}
