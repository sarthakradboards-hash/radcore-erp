// RAD-32 (M1-14, ADR-004 §3, RC-021): the first admin, on a real PostgreSQL as the runtime login. The command invites
// SEED_ADMIN_EMAIL once ever, with no password printed or logged anywhere, and can re-issue the invite only until
// someone has accepted it. Each test gets a freshly migrated database of its own: the record is one per database.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { loadConfig } from '@radcore/lib-platform';
import { createDatabase, loadPrincipal, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { migrate } from '../packages/db/src/migrate.ts';
import { createAccount } from '../packages/lib-platform/src/auth/account.ts';
import { bootstrapAdmin, runBootstrapAdmin } from '../packages/lib-platform/src/auth/bootstrap.ts';
import type { Lockout } from '../packages/lib-platform/src/auth/lockout.ts';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';
import type { Database } from '../packages/db/src/schema.ts';
import type { Mail } from '../packages/lib-platform/src/mail.ts';
import { ensureLogins } from './db-logins.ts';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
const ORIGIN = loadConfig(testSettings(), 'api').publicOrigin;
const SEED = 'Owner.Person@Example.in';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Fresh = { url: string; db: Database; sql: <T extends pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>; appSql: (text: string) => Promise<string> };

// A database with every migration, as the owner made it; the command runs as the runtime login.
async function withDatabase(fn: (d: Fresh) => Promise<void>) {
  const name = `radcore_boot_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const at = (role?: string) => {
    const u = new URL(adminUrl ?? '');
    u.pathname = `/${name}`;
    if (role !== undefined) u.searchParams.set('options', `-c role=${role}`);
    return u.toString();
  };
  const pool = new pg.Pool({ connectionString: at('radcore_app'), max: 2 });
  try {
    await ensureLogins(at());
    await migrate(at('radcore_owner'));
    const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
      const c = new pg.Client({ connectionString: at() });
      await c.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        const { rows } = await c.query<T>(text, values);
        await c.query('commit');
        return rows;
      } finally {
        await c.end();
      }
    };
    // The SQLSTATE a statement fails with as the runtime login, or 'ok'.
    const appSql = async (text: string) => pool.query(text).then(() => 'ok', (e: unknown) => (e as { code?: string }).code ?? 'error');
    await fn({ url: at('radcore_app'), db: createDatabase(pool), sql, appSql });
  } finally {
    await pool.end();
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    await c.query(`drop database if exists ${name} with (force)`);
    await c.end();
  }
}

const recorder = () => {
  const sent: Mail[] = [];
  return { sent, mailer: { send: vi.fn(async (m: Mail) => { sent.push(m); }) } };
};
const tokenIn = (m: Mail | undefined) => /\/invite#token=([A-Za-z0-9_-]{16,512})$/m.exec(m?.text ?? '')?.[1] ?? '';

describe.skipIf(!adminUrl)('the first admin', { timeout: 60_000 }, () => {
  it('invites SEED_ADMIN_EMAIL once, with the link only in the email, as the admin', async () => {
    await withDatabase(async ({ db, sql }) => {
      const { sent, mailer } = recorder();
      const done = await bootstrapAdmin(db, { email: SEED, reissue: false, mailer, publicOrigin: ORIGIN });
      expect(done).toEqual({ outcome: 'invited', to: 'o…n@example.in' });
      const [user] = await sql<{ email: string; status: string; role: string }>('select email, status, role from radcore.users');
      expect([user?.email, user?.status, user?.role]).toEqual(['owner.person@example.in', 'invited', 'admin']);
      expect(sent.map((m) => m.to)).toEqual(['owner.person@example.in']);
      const token = tokenIn(sent[0]);
      expect(sent[0]?.text).toContain(`${ORIGIN}/invite#token=${token}`);
      expect(await sql('select token_hash, sent_at is not null as sent from radcore.invites')).toEqual([{ token_hash: sha256(token), sent: true }]);
      expect(JSON.stringify(done)).not.toContain(token);
      expect(await sql('select key from radcore.bootstrap')).toEqual([{ key: 'first_admin' }]);
    });
  });

  // RC-021 (RAD-35): v1 could create the first admin locked out. Here the invite gives them the admin role, and once
  // they've set their password they're an active person holding every admin key, read fresh as any request reads them.
  it('makes the first admin an admin: once they accept, they sign in holding every admin key, not locked out (RC-021)', async () => {
    await withDatabase(async ({ db, sql }) => {
      const { sent, mailer } = recorder();
      await bootstrapAdmin(db, { email: SEED, reissue: false, mailer, publicOrigin: ORIGIN });
      const [user] = await sql<{ id: string; role: string }>('select id, role from radcore.users');
      expect(user?.role).toBe('admin');
      const account = createAccount({ passwords: await createPasswords(), lockout: { succeeded: async () => undefined } as unknown as Lockout });
      await runInTransaction(db, { readOnly: false, isolation: 'read committed' }, { kind: 'system', name: 'public', permissions: [] },
        randomUUID(), (ctx) => account.acceptInvite(ctx, { token: tokenIn(sent[0]), password: 'a long enough first password' }));
      const admin = await loadPrincipal(db)(`user:${user?.id ?? ''}`);
      const [{ keys } = { keys: [] }] = await sql<{ keys: string[] }>(
        "select array_agg(permission order by permission) as keys from radcore.role_grants where role = 'admin'");
      expect(admin).toMatchObject({ kind: 'user', userId: user?.id, role: 'admin', ownScope: [] });
      expect(admin?.permissions).toEqual(expect.arrayContaining([...keys, 'users:write', 'roles:write']));
    });
  });

  it('does nothing when run again, and re-issues only on request while nobody has accepted', async () => {
    await withDatabase(async ({ db, sql }) => {
      const { sent, mailer } = recorder();
      const run = (reissue: boolean, email = SEED) => bootstrapAdmin(db, { email, reissue, mailer, publicOrigin: ORIGIN });
      await run(false);
      expect(await run(false)).toEqual({ outcome: 'already_bootstrapped', to: null });
      expect(sent).toHaveLength(1);
      expect(await run(true)).toEqual({ outcome: 'reissued', to: 'o…n@example.in' });
      expect(sent).toHaveLength(2);
      // The old link is spent; only the new one works.
      expect(await sql('select token_hash, used_at is not null as used from radcore.invites order by created_at, id'))
        .toEqual([{ token_hash: sha256(tokenIn(sent[0])), used: true }, { token_hash: sha256(tokenIn(sent[1])), used: false }]);
      // A re-issue goes only to the address first invited.
      await expect(run(true, 'someone.else@example.in')).rejects.toThrow(/SEED_ADMIN_EMAIL/);
      expect(sent).toHaveLength(2);
      // Once the admin has set a password, nothing more.
      await sql("update radcore.users set status = 'active', password_hash = '$argon2id$v=19$m=19456,t=2,p=1$x$y', password_set_at = now()");
      expect(await run(true)).toEqual({ outcome: 'admin_exists', to: null });
      expect(sent).toHaveLength(2);
    });
  });

  // The command as the deploy job runs it: its settings checked, one line of output, a masked address, no link.
  it('runs from the settings and SEED_ADMIN_EMAIL, and says only what it did and to whom, masked', async () => {
    await withDatabase(async ({ url }) => {
      const u = new URL(url);
      u.password = testPassword();
      const env = testSettings({ DATABASE_URL: u.toString(), SEED_ADMIN_EMAIL: SEED });
      const log = { info: vi.fn<(m: string) => void>(), error: vi.fn() };
      expect(await runBootstrapAdmin(env, log, { reissue: false })).toBe('first admin: invited, invite sent to o…n@example.in');
      expect(await runBootstrapAdmin(env, log, { reissue: false })).toBe('first admin: already_bootstrapped, nothing sent');
      expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/token|owner\.person/i);
      await expect(runBootstrapAdmin({ ...env, SEED_ADMIN_EMAIL: undefined }, log, { reissue: false })).rejects.toThrow(/SEED_ADMIN_EMAIL/);
    });
  });

  it('keeps the bootstrap record for good: the runtime login can neither change nor remove it', async () => {
    await withDatabase(async ({ db, appSql }) => {
      const { mailer } = recorder();
      await bootstrapAdmin(db, { email: SEED, reissue: false, mailer, publicOrigin: ORIGIN });
      expect([await appSql('delete from radcore.bootstrap'), await appSql("update radcore.bootstrap set key = 'x'"),
        await appSql('truncate radcore.bootstrap')]).toEqual(['42501', '42501', '42501']);
    });
  });
});
