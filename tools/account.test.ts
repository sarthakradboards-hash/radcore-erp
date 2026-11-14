// RAD-32 (M1-14, ADR-001 §7a, RAD-64): setting a password on a real PostgreSQL, as the runtime login. An invite and a
// reset are single-use links that start no session; a change needs the current password, counted like a sign-in.
// The new-password rules ran before these services (the handler's pre-transaction check); they check same_as_old.
import { createHash, randomBytes } from 'node:crypto';
import { AppError, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createAccount } from '../packages/lib-platform/src/auth/account.ts';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
// Collecting a skipped suite still builds its store; a pool connects only when used, so this is never reached.
const NO_DATABASE = 'postgres://unused@127.0.0.1:1/unused';
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const database = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api').database;
};
const write = { readOnly: false, isolation: 'read committed' } as const;
const OLD = 'a quiet harbour at dawn';
const NEW = 'the lighthouse keeps its own time';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe.skipIf(!url)('setting a password', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const store = createLimiterStore(database(url ?? NO_DATABASE), { info: () => undefined, error: () => undefined });
  afterAll(async () => {
    await store.end();
    await pool.end();
  });

  // Runs SQL as the superuser, with a principal for the audit columns.
  async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const c = new pg.Client({ connectionString: superUrl });
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
  }
  async function setup() {
    const passwords = await createPasswords();
    const lockout = createLockout(store.limiter({ prefix: `test${randomBytes(4).toString('hex')}`, ...LOCKOUT }));
    const account = createAccount({ passwords, lockout });
    const email = `user.${randomBytes(4).toString('hex')}@example.in`;
    const run = <R>(principal: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, principal, 'req-1', fn);
    const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
      (e instanceof AppError ? [e.code, ...e.issues.map((i) => i.code)].join(':') : String(e)));
    const user = async (status: 'invited' | 'active') => (await asAdmin<{ id: string }>(`insert into radcore.users (email,
      display_name, status, password_hash, password_set_at, role) values ($1, 'Test', $2, $3,
      case when $3::text is null then null else now() end, 'sales') returning id`, [email, status,
      status === 'active' ? await passwords.hash(OLD) : null]))[0]?.id ?? '';
    const link = async (table: 'invites' | 'password_resets', userId: string, expiresInSeconds = 3600) => {
      const token = randomBytes(32).toString('base64url');
      await asAdmin(`insert into radcore.${table} (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(secs => $3))`,
        [userId, sha256(token), expiresInSeconds]);
      return token;
    };
    const stored = async (userId: string) => (await asAdmin<{ status: string; hash: string | null }>(
      'select status, password_hash as hash from radcore.users where id = $1', [userId]))[0];
    const anon: Principal = { kind: 'system', name: 'public', permissions: [] };
    return { passwords, lockout, account, email, run, outcome, user, link, stored, anon };
  }

  it('accepts an invite once: the person sets a password, becomes active, and no session starts', async () => {
    const s = await setup();
    const id = await s.user('invited');
    const token = await s.link('invites', id);
    expect(await s.run(s.anon, (ctx) => s.account.acceptInvite(ctx, { token, password: NEW }))).toEqual({});
    const after = await s.stored(id);
    expect(after?.status).toBe('active');
    expect(await s.passwords.verify(after?.hash ?? null, NEW)).toEqual({ ok: true, rehash: false });
    expect(await s.outcome(s.run(s.anon, (ctx) => s.account.acceptInvite(ctx, { token, password: NEW })))).toBe('link_expired');
  });

  // RAD-61: an unknown, a used and an expired token get one answer.
  it('answers an unknown, expired or used link alike, and changes nothing', async () => {
    const s = await setup();
    const id = await s.user('invited');
    const expired = await s.link('invites', id, -1);
    expect([
      await s.outcome(s.run(s.anon, (ctx) => s.account.acceptInvite(ctx, { token: randomBytes(32).toString('base64url'), password: NEW }))),
      await s.outcome(s.run(s.anon, (ctx) => s.account.acceptInvite(ctx, { token: expired, password: NEW }))),
    ]).toEqual(['link_expired', 'link_expired']);
    expect((await s.stored(id))?.status).toBe('invited');
  });

  it('resets a password once, refusing the current one, and clears the address lock', async () => {
    const s = await setup();
    const id = await s.user('active');
    const token = await s.link('password_resets', id);
    const other = await s.link('password_resets', id);
    for (let i = 0; i <= LOCKOUT.points; i++) await s.lockout.attempt(s.email);
    expect(await s.outcome(s.run(s.anon, (ctx) => s.account.resetPassword(ctx, { token, password: OLD }))))
      .toBe('password_rejected:same_as_old');
    expect(await s.run(s.anon, (ctx) => s.account.resetPassword(ctx, { token, password: NEW }))).toEqual({});
    expect(await s.passwords.verify((await s.stored(id))?.hash ?? null, NEW)).toEqual({ ok: true, rehash: false });
    // The lock is gone, and every other reset link for this person is spent.
    expect(await s.lockout.attempt(s.email)).toBe(0);
    expect(await s.outcome(s.run(s.anon, (ctx) => s.account.resetPassword(ctx, { token: other, password: NEW })))).toBe('link_expired');
  });

  it('changes a password with the right current one, counting a wrong one towards the lock', async () => {
    const s = await setup();
    const id = await s.user('active');
    const me: Principal = { kind: 'user', userId: id, permissions: ['session:read'] };
    const change = (currentPassword: string, newPassword: string) =>
      s.run(me, (ctx) => s.account.changePassword(ctx, { currentPassword, newPassword }));
    expect(await s.outcome(change('wrong but long enough', NEW))).toBe('invalid_credentials');
    expect(await s.outcome(change(OLD, OLD))).toBe('password_rejected:same_as_old');
    expect(await change(OLD, NEW)).toEqual({ otherSessionsEnded: 0 });
    expect(await s.passwords.verify((await s.stored(id))?.hash ?? null, NEW)).toEqual({ ok: true, rehash: false });
    // A wrong current password is counted like a failed sign-in (auditor-2 on #76): the allowance runs out.
    for (let i = 0; i < LOCKOUT.points; i++) await s.outcome(change('wrong but long enough', OLD));
    expect(await s.outcome(change(NEW, OLD))).toBe('account_locked');
  });
});
