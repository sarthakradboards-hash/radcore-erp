// RAD-34 (M1-16, ADR-001 §7a, RC-091): sign-in sessions on a real PostgreSQL, as the runtime login. A session ends
// after 30 minutes idle or 12 hours, whichever is first, or when it's ended: by sign-out, by the person, by an admin,
// or by a password change or reset. Each start and end is a security event. The cookie is set only after commit.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError, loadConfig, RecordedRefusal, type Ctx, type Principal } from '@radcore/lib-platform';
import { authenticateSession, createAuth, createDatabase, runInTransaction, tokenFromCookie } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import platform from '../apps/api/src/routes/platform.ts';
import { createAccount } from '../packages/lib-platform/src/auth/account.ts';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';
import {
  endAnySession, endCurrentSession, endOwnSession, endPersonSessions, getMyself, listAllSessions, listOwnSessions,
  SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS, signInService,
} from '../packages/lib-platform/src/auth/sessions.ts';
import { createSignIn } from '../packages/lib-platform/src/auth/sign-in.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
// Collecting a skipped suite still builds its store; a pool connects only when used, so this is never reached.
const NO_DATABASE = 'postgres://unused@127.0.0.1:1/unused';
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const config = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api');
};
const log = { info: () => undefined, error: () => undefined };
const write = { readOnly: false, isolation: 'read committed' } as const;
const PASSWORD = 'a quiet harbour at dawn';
const NEW = 'the lighthouse keeps its own time';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe.skipIf(!url)('sign-in sessions', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  const store = createLimiterStore(config(url ?? NO_DATABASE).database, log);
  const passwordsReady = createPasswords();
  afterAll(async () => {
    await store.end();
    await pool.end();
  });

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
  const PUBLIC: Principal = { kind: 'system', name: 'public', permissions: [] };
  const run = <R>(principal: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, principal, randomUUID(), fn);
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  async function setup() {
    const passwords = await passwordsReady;
    const lockout = createLockout(store.limiter({ prefix: `test${randomBytes(4).toString('hex')}`, ...LOCKOUT }));
    const signIn = signInService(createSignIn({ passwords, lockout, secondFactor: async () => 'not_required' }));
    const account = createAccount({ passwords, lockout });
    const email = `user.${randomBytes(4).toString('hex')}@example.in`;
    const [user] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at) values ($1, 'Asha Rao', 'active', $2, now()) returning id`, [email, await passwords.hash(PASSWORD)]);
    const userId = user?.id ?? '';
    // A device name of this test's own, so its security events can be found even when they name no account.
    const device = `test ${randomBytes(6).toString('hex')}`;
    // Signs in through the route's service as the handler runs it, and returns the token its cookie would carry.
    const signInNow = async () => {
      const set = vi.fn<(token: string, expires: Date) => void>();
      await run(PUBLIC, (ctx) => signIn({ ...ctx, cookie: { device, set, clear: vi.fn() } }, { email, password: PASSWORD }));
      return set.mock.calls[0]?.[0] ?? '';
    };
    const principalOf = async (token: string, touch = false) => authenticateSession(db, token, { touch });
    const as = async (token: string, extra: string[] = []): Promise<Principal> => {
      const p = await principalOf(token);
      if (p === null) throw new Error('not signed in');
      return { ...p, permissions: [...p.permissions, ...extra] };
    };
    const row = async (token: string) => (await asAdmin<{ id: string; ended_reason: string | null; idle: Date; absolute: Date;
      last_seen_at: Date; created_at: Date; device: string }>(`select id, ended_reason, idle_expires_at as idle,
      absolute_expires_at as absolute, last_seen_at, created_at, device from radcore.sessions where token_hash = $1`,
    [sha256(token)]))[0];
    const events = async () => asAdmin<{ kind: string; detail: unknown }>(
      'select kind, detail from radcore.event_log where user_id = $1 order by occurred_at, seq', [userId]);
    return { passwords, signIn, account, email, userId, device, signInNow, principalOf, as, row, events };
  }

  it('starts a session on sign-in: the token in the cookie, only its hash stored, and a sign_in event', async () => {
    const s = await setup();
    const set = vi.fn<(token: string, expires: Date) => void>();
    expect(await run(PUBLIC, (ctx) => s.signIn({ ...ctx, cookie: { device: s.device, set, clear: vi.fn() } },
      { email: s.email, password: PASSWORD }))).toEqual({ next: 'done' });
    const [token, expires] = set.mock.calls[0] ?? [];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await s.row(token ?? '');
    expect(stored?.device).toBe(s.device);
    // 12 hours from the sign-in, and the idle expiry 30 minutes from it; the cookie expires with the session.
    const since = (d: Date | undefined) => (d?.getTime() ?? 0) - (stored?.created_at.getTime() ?? 0);
    expect(expires?.getTime()).toBe(stored?.absolute.getTime());
    expect(Math.abs(since(stored?.absolute) - SESSION_ABSOLUTE_SECONDS * 1000)).toBeLessThan(5000);
    expect(Math.abs(since(stored?.idle) - SESSION_IDLE_SECONDS * 1000)).toBeLessThan(5000);
    expect(await s.principalOf(token ?? '')).toEqual({ kind: 'user', userId: s.userId, sessionId: stored?.id, permissions: ['session:read'] });
    expect(await s.events()).toEqual([{ kind: 'sign_in', detail: {} }]);
  });

  it('records a failed sign-in, for the account or for nobody, and starts no session', async () => {
    const s = await setup();
    const set = vi.fn();
    const attempt = (email: string) => run(PUBLIC, (ctx) => s.signIn({ ...ctx, cookie: { device: s.device, set, clear: vi.fn() } },
      { email, password: 'not the password at all' }).catch((e: unknown) => e));
    // The handler commits a RecordedRefusal's transaction; here the catch inside it does the same.
    const wrong = await attempt(s.email);
    expect([wrong instanceof RecordedRefusal, (wrong as AppError).code]).toEqual([true, 'invalid_credentials']);
    await attempt(`nobody.${randomBytes(4).toString('hex')}@example.in`);
    expect(set).not.toHaveBeenCalled();
    expect(await asAdmin('select user_id, kind, detail from radcore.event_log where device = $1 order by occurred_at, seq', [s.device]))
      .toEqual([{ user_id: s.userId, kind: 'sign_in_failed', detail: { reason: 'invalid_credentials' } },
        { user_id: null, kind: 'sign_in_failed', detail: { reason: 'invalid_credentials' } }]);
    expect(await asAdmin('select 1 from radcore.sessions where user_id = $1', [s.userId])).toEqual([]);
  });

  it('signs nobody in once a session is idle 30 minutes, 12 hours old, ended, or its person disabled', async () => {
    const s = await setup();
    const tokens = await Promise.all([1, 2, 3, 4].map(async () => s.signInNow()));
    const [idle, old, ended] = tokens.map((t) => sha256(t));
    await asAdmin("update radcore.sessions set idle_expires_at = now() - interval '1 second' where token_hash = $1", [idle]);
    await asAdmin("update radcore.sessions set absolute_expires_at = now() - interval '1 second' where token_hash = $1", [old]);
    await asAdmin("update radcore.sessions set ended_at = now(), ended_reason = 'admin' where token_hash = $1", [ended]);
    expect(await Promise.all(tokens.map(async (t) => (await s.principalOf(t)) !== null))).toEqual([false, false, false, true]);
    expect(await s.principalOf(`${tokens[3]?.slice(0, -1) ?? ''}A`)).toBeNull();
    await asAdmin("update radcore.users set status = 'disabled' where id = $1", [s.userId]);
    expect(await s.principalOf(tokens[3] ?? '')).toBeNull();
  });

  it('moves the idle expiry on activity, never past the absolute one, and not on a read of /me', async () => {
    const s = await setup();
    const token = await s.signInNow();
    const hash = sha256(token);
    await asAdmin(`update radcore.sessions set last_seen_at = now() - interval '5 minutes',
      idle_expires_at = now() + interval '25 minutes' where token_hash = $1`, [hash]);
    const before = (await s.row(token))?.idle.getTime() ?? 0;
    await s.principalOf(token, false);
    expect((await s.row(token))?.idle.getTime()).toBe(before);
    await s.principalOf(token, true);
    // The idle expiry is 30 minutes from this activity, which is now the last seen.
    const moved = await s.row(token);
    expect((moved?.idle.getTime() ?? 0) - (moved?.last_seen_at.getTime() ?? 0)).toBe(SESSION_IDLE_SECONDS * 1000);
    expect(moved?.idle.getTime()).toBeGreaterThan(before);
    // Ten minutes before the absolute expiry, activity moves the idle expiry only as far as it.
    await asAdmin(`update radcore.sessions set last_seen_at = now() - interval '5 minutes',
      absolute_expires_at = now() + interval '10 minutes' where token_hash = $1`, [hash]);
    await s.principalOf(token, true);
    const capped = await s.row(token);
    expect(capped?.idle.getTime()).toBe(capped?.absolute.getTime());
  });

  it('answers /me with the person, their permissions and when this session ends', async () => {
    const s = await setup();
    const token = await s.signInNow();
    const stored = await s.row(token);
    expect(await run(await s.as(token), getMyself)).toEqual({ user: { id: s.userId, displayName: 'Asha Rao' },
      permissions: ['session:read'], session: { idleExpiresAt: stored?.idle.toISOString(),
        absoluteExpiresAt: stored?.absolute.toISOString() }, secondFactor: 'not_required' });
  });

  it("lists the person's own live sessions a page at a time, newest activity first, marking this one", async () => {
    const s = await setup();
    const [first, second, gone] = [await s.signInNow(), await s.signInNow(), await s.signInNow()];
    await asAdmin("update radcore.sessions set ended_at = now(), ended_reason = 'admin' where token_hash = $1", [sha256(gone)]);
    await asAdmin("update radcore.sessions set last_seen_at = now() - interval '1 minute' where token_hash = $1", [sha256(first)]);
    const me = await s.as(first);
    const page1 = await run(me, (ctx) => listOwnSessions(ctx, { filter: {}, limit: 1 }));
    const page2 = await run(me, (ctx) => listOwnSessions(ctx, { filter: {}, limit: 1, after: page1.next ?? '' }));
    expect([...page1.items, ...page2.items].map((i) => [i.id, i.current, i.device])).toEqual([
      [(await s.row(second))?.id, false, s.device], [(await s.row(first))?.id, true, s.device]]);
    expect(page2.next).toBeNull();
  });

  it('lets a person end another of their sessions, but not this one or anyone else’s', async () => {
    const s = await setup();
    const other = await setup();
    const [mine, theirs, elsewhere] = [await s.signInNow(), await s.signInNow(), await other.signInNow()];
    const me = await s.as(mine);
    const idOf = async (t: string) => (await (t === elsewhere ? other : s).row(t))?.id ?? '';
    expect(await outcome(run(me, async (ctx) => endOwnSession(ctx, { id: await idOf(mine) })))).toBe('current_session');
    expect(await outcome(run(me, async (ctx) => endOwnSession(ctx, { id: await idOf(elsewhere) })))).toBe('not_found');
    expect(await outcome(run(me, async (ctx) => endOwnSession(ctx, { id: await idOf(theirs) })))).toBe('ok');
    expect([await s.principalOf(theirs), (await s.row(theirs))?.ended_reason]).toEqual([null, 'sign_out']);
    expect(await other.principalOf(elsewhere)).not.toBeNull();
    expect(await outcome(run(me, async (ctx) => endOwnSession(ctx, { id: await idOf(theirs) })))).toBe('not_found');
  });

  it('signs out: this session ends with a session_ended event and the cookie is cleared', async () => {
    const s = await setup();
    const token = await s.signInNow();
    const clear = vi.fn();
    const me = await s.as(token);
    await run(me, (ctx) => endCurrentSession({ ...ctx, cookie: { device: s.device, set: vi.fn(), clear } }));
    expect([clear.mock.calls.length, await s.principalOf(token)]).toEqual([1, null]);
    expect(await s.events()).toEqual([{ kind: 'sign_in', detail: {} }, { kind: 'session_ended', detail: { reason: 'sign_out' } }]);
  });

  it('ends the other sessions on a password change, keeping this one, and every session on a reset', async () => {
    const s = await setup();
    const [here, there, also] = [await s.signInNow(), await s.signInNow(), await s.signInNow()];
    expect(await run(await s.as(here), (ctx) => s.account.changePassword(ctx, { currentPassword: PASSWORD, newPassword: NEW })))
      .toEqual({ otherSessionsEnded: 2 });
    expect([await s.principalOf(here) !== null, await s.principalOf(there), (await s.row(also))?.ended_reason])
      .toEqual([true, null, 'password_changed']);
    const token = randomBytes(32).toString('base64url');
    await asAdmin("insert into radcore.password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
      [s.userId, sha256(token)]);
    await run(PUBLIC, (ctx) => s.account.resetPassword(ctx, { token, password: `${NEW} again` }));
    expect([await s.principalOf(here), (await s.row(here))?.ended_reason]).toEqual([null, 'password_reset']);
    expect((await s.events()).filter((e) => e.kind !== 'sign_in')).toEqual([
      { kind: 'password_changed', detail: { how: 'change' } },
      { kind: 'session_ended', detail: { reason: 'password_changed' } },
      { kind: 'session_ended', detail: { reason: 'password_changed' } },
      { kind: 'session_ended', detail: { reason: 'password_reset' } },
      { kind: 'password_changed', detail: { how: 'reset' } },
    ]);
  });

  it("lets an admin list and end anyone's sessions, but not their own current one or their own account's", async () => {
    const admin = await setup();
    const person = await setup();
    const mine = await admin.signInNow();
    const [a, b] = [await person.signInNow(), await person.signInNow()];
    const as = await admin.as(mine, ['users:read', 'users:write']);
    const listed = await run(as, (ctx) => listAllSessions(ctx, { filter: { userId: person.userId }, limit: 50 }));
    expect(listed.items.map((i) => [i.user, i.current]).toSorted()).toEqual([
      [{ id: person.userId, displayName: 'Asha Rao' }, false], [{ id: person.userId, displayName: 'Asha Rao' }, false]]);
    const own = await run(as, (ctx) => listAllSessions(ctx, { filter: { userId: admin.userId }, limit: 50 }));
    expect(own.items.map((i) => i.current)).toEqual([true]);
    expect(await outcome(run(as, async (ctx) => endAnySession(ctx, { id: (await admin.row(mine))?.id ?? '' })))).toBe('current_session');
    expect(await outcome(run(as, async (ctx) => endAnySession(ctx, { id: (await person.row(a))?.id ?? '' })))).toBe('ok');
    expect(await outcome(run(as, async (ctx) => endAnySession(ctx, { id: (await person.row(a))?.id ?? '' })))).toBe('not_found');
    expect(await outcome(run(as, (ctx) => endPersonSessions(ctx, { id: admin.userId })))).toBe('own_account');
    expect(await run(as, (ctx) => endPersonSessions(ctx, { id: person.userId }))).toEqual({ ended: 1 });
    expect([(await person.row(a))?.ended_reason, (await person.row(b))?.ended_reason]).toEqual(['admin', 'admin']);
    expect(await admin.principalOf(mine)).not.toBeNull();
  });

  // The whole path as the browser takes it: the api's own routes, wiring and cookie.
  it('signs in and out over HTTP with a __Host- cookie that is HttpOnly, Secure and SameSite=Lax', async () => {
    const s = await setup();
    const cfg = config(url ?? NO_DATABASE);
    const auth = await createAuth(cfg, log);
    const app = createApp(cfg, log, { db, routes: [...platform, ...auth.routes], newPasswordCheck: async () => null,
      authenticate: (req, route) => authenticateSession(db, tokenFromCookie(req.get('cookie')), { touch: route !== 'GET /me' }) });
    const server = await listen(app, 0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'content-type': 'application/json', origin: cfg.publicOrigin, 'user-agent': CHROME_ANDROID };
    try {
      const signedIn = await fetch(`${base}/sign-in`, { method: 'POST', headers, body: JSON.stringify({ email: s.email, password: PASSWORD }) });
      expect([signedIn.status, await signedIn.json()]).toEqual([200, { next: 'done' }]);
      const cookie = signedIn.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/^__Host-radcore_session=[A-Za-z0-9_-]{43}; Path=\/; Expires=.+; HttpOnly; Secure; SameSite=Lax$/);
      const token = tokenFromCookie(cookie.split(';')[0]) ?? '';
      expect((await s.row(token))?.device).toBe('Chrome on Android');
      const me = await fetch(`${base}/me`, { headers: { cookie: `__Host-radcore_session=${token}` } });
      expect([me.status, ((await me.json()) as { user: { id: string } }).user.id]).toEqual([200, s.userId]);
      const out = await fetch(`${base}/sign-out`, { method: 'POST', headers: { ...headers, cookie: `__Host-radcore_session=${token}` }, body: '{}' });
      expect(out.status).toBe(200);
      expect(out.headers.get('set-cookie')).toMatch(/^__Host-radcore_session=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/);
      expect((await fetch(`${base}/me`, { headers: { cookie: `__Host-radcore_session=${token}` } })).status).toBe(401);
      // A wrong password: refused, recorded, and no cookie.
      const wrong = await fetch(`${base}/sign-in`, { method: 'POST', headers, body: JSON.stringify({ email: s.email, password: 'nope nope nope' }) });
      expect([wrong.status, ((await wrong.json()) as { code: string }).code, wrong.headers.get('set-cookie')])
        .toEqual([422, 'invalid_credentials', null]);
      expect((await s.events()).map((e) => e.kind)).toEqual(['sign_in', 'session_ended', 'sign_in_failed']);
    } finally {
      await server.stop();
      await auth.store.stop();
    }
  });
});
