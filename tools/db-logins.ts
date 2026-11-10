// RAD-24 (M1-06, ADR-005 §7c): makes the three logins and gives the owner login the database, before the first
// migration. Logins belong to the whole server, not one database, and carry passwords, so they can't be a migration.
// What each login may do is the owner migration 0002_logins.sql. Run as a superuser or, on RDS, the master user (which
// has CREATEROLE but isn't a superuser): `npm run db:logins`, with DATABASE_ADMIN_URL pointing at the database and
// the passwords in the environment (.env in development).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

export const LOGINS = ['radcore_owner', 'radcore_app', 'radcore_read'] as const;
type Login = (typeof LOGINS)[number];
const ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier PostgreSQL stores for a password (RFC 7677, PostgreSQL's pg_authid format). Sending it
 * instead of the password keeps the password out of the server's statement log.
 * shortcut: no SASLprep normalisation, which matches PostgreSQL only for ASCII; the passwords here are base64url.
 */
export function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest();
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${hmac(salted, 'Server Key').toString('base64')}`;
}

/**
 * Idempotent. A login's password is set only when given, so CI's trust-auth server and the tests leave it alone.
 * The safe attributes are PostgreSQL's defaults for a new role; an existing login with an unsafe one is refused, not
 * changed, since a CREATEROLE user (RDS's master) can't change those.
 */
export async function ensureLogins(adminUrl: string, passwords: Partial<Record<Login, string>> = {}): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Two test runs on one server would otherwise race to create the same login.
    await client.query("select pg_advisory_lock(hashtextextended('radcore.logins', 0))");
    for (const login of LOGINS) {
      // The names are the constants above, so they can be written into the statement; identifiers can't be bound.
      await client.query(`do $$ begin
        if not exists (select from pg_roles where rolname = '${login}') then create role ${login} login; end if; end $$`);
      const password = passwords[login];
      await client.query(`alter role ${login} with login`
        + (password === undefined ? '' : ` password ${client.escapeLiteral(scramVerifier(password))}`));
    }
    const { rows: unsafe } = await client.query<{ rolname: string }>(`select rolname from pg_roles where rolname = any($1)
      and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls) order by rolname`, [[...LOGINS]]);
    if (unsafe.length > 0) {
      throw new Error(`${unsafe.map((r) => r.rolname).join(', ')} may make roles or databases, replicate, bypass row `
        + 'security or is a superuser: remove that with the superuser, then run this again');
    }
    // ALTER DATABASE ... OWNER needs the caller to be able to SET ROLE to the new owner. A superuser can already;
    // RDS's master, which created the login, gets that membership here (PostgreSQL 16).
    const { rows: [me] } = await client.query<{ superuser: boolean; name: string }>(
      "select current_setting('is_superuser') = 'on' as superuser, current_database() as name");
    if (me?.superuser === false) await client.query('grant radcore_owner to current_user with set true, inherit false');
    await client.query(`alter database ${client.escapeIdentifier(me?.name ?? '')} owner to radcore_owner`);
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
