// RAD-24 (M1-06, ADR-005 §7c): makes the three logins and gives the owner login the database, before the first
// migration. Logins belong to the whole server, not one database, and carry passwords, so they can't be a migration.
// What each login may do is the owner migration 0002_logins.sql. Run as a superuser (compose's, CI's, or RDS's master
// user): `npm run db:logins`, with DATABASE_ADMIN_URL pointing at the database and the passwords in .env.
import pg from 'pg';

export const LOGINS = ['radcore_owner', 'radcore_app', 'radcore_read'] as const;
type Login = (typeof LOGINS)[number];

/** Idempotent. A login's password is set only when given, so CI's trust-auth server and tests leave them alone. */
export async function ensureLogins(adminUrl: string, passwords: Partial<Record<Login, string>> = {}): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Two test runs on one server would otherwise race to create the same login.
    await client.query("select pg_advisory_lock(hashtextextended('radcore.logins', 0))");
    for (const login of LOGINS) {
      // The names are the constants above, so they can be written into the statement; identifiers can't be bound.
      await client.query(`do $$ begin
        if not exists (select from pg_roles where rolname = '${login}') then create role ${login}; end if; end $$`);
      const password = passwords[login];
      await client.query(`alter role ${login} with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls`
        + (password === undefined ? '' : ` password ${client.escapeLiteral(password)}`));
    }
    // The migrations run as the owner, so they need the database's CREATE, and REVOKE on the database itself.
    const { rows } = await client.query<{ name: string }>('select current_database() as name');
    await client.query(`alter database ${client.escapeIdentifier(rows[0]?.name ?? '')} owner to radcore_owner`);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const adminUrl = process.env['DATABASE_ADMIN_URL'];
  if (!adminUrl) {
    throw new Error('DATABASE_ADMIN_URL is not set. An .env from before RAD-24 lacks it: run '
      + '`docker compose -f compose.dev.yml down -v`, delete .env, then `npm run db:up`.');
  }
  const passwords: Partial<Record<Login, string>> = {};
  for (const login of LOGINS) {
    const password = process.env[`${login.toUpperCase()}_PASSWORD`];
    if (password) passwords[login] = password;
  }
  await ensureLogins(adminUrl, passwords);
  console.log('logins ready: radcore_owner, radcore_app, radcore_read');
}
