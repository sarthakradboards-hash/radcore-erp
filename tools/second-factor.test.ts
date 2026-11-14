// RAD-33 (M1-15, D-19, ADR-001 §7a, ADR-003, RC-055): the second sign-in factor on a real PostgreSQL, as the runtime
// login. After the password, a person with a factor, or whose role needs one, gets only a pending sign-in; a TOTP code
// or a single-use recovery code then starts the session. Enrolment answers the otpauth URI, then the first code
// confirms it, signs the person in and answers ten recovery codes. A code works once, attempts are limited per
// account, and every change is a security event holding no secret or code. The clock is a fake: no run date is read.
import { createHash, randomBytes } from 'node:crypto';
import { AppError, loadConfig, RecordedRefusal, type BeforeDeps, type Ctx, type Principal } from '@radcore/lib-platform';
import { SECURITY_EVENT_ROUTES } from '@radcore/lib-platform/contract';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { fakeClock, testPassword, testSettings } from '@radcore/test-helpers';
import { Secret, URI } from 'otpauth';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';
import { createSecondFactor, SECOND_FACTOR_ATTEMPTS } from '../packages/lib-platform/src/auth/second-factor.ts';
import { secondFactorStatus } from '../packages/lib-platform/src/auth/second-factor-status.ts';
import { getMyself, signInService } from '../packages/lib-platform/src/auth/sessions.ts';
import { createSignIn } from '../packages/lib-platform/src/auth/sign-in.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';
import { createSecrets } from '../packages/lib-platform/src/secrets.ts';
import { codeAt, enrolTestUser } from './second-factor-fixture.ts';

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
const read = { readOnly: true, isolation: 'read committed' } as const;
const PASSWORD = 'a quiet harbour at dawn';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const PUBLIC: Principal = { kind: 'system', name: 'public', permissions: [] };

describe.skipIf(!url)('the second sign-in factor', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  const cfg = config(url ?? NO_DATABASE);
  const store = createLimiterStore(cfg.database, log);
  const passwordsReady = createPasswords();
  const secrets = createSecrets(cfg.secrets);
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
  const run = <R>(principal: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, principal, 'req-2fa', fn);
  // What a call answered: 'ok', or the code it refused with ('recorded:' when its record committed).
  const outcome = (call: Promise<unknown>) => call.then(() => 'ok',
    (e: unknown) => (e instanceof AppError ? `${e instanceof RecordedRefusal ? 'recorded:' : ''}${e.code}` : String(e)));

  async function setup() {
    const passwords = await passwordsReady;
    const prefix = randomBytes(4).toString('hex');
    const clock = fakeClock('2026-11-14T06:00:00Z');
    const factor = createSecondFactor({ passwords, now: clock.now,
      attempts: store.limiter({ prefix: `test2fa${prefix}`, ...SECOND_FACTOR_ATTEMPTS }) });
    const signIn = signInService(createSignIn({ passwords, secondFactor: secondFactorStatus,
      lockout: createLockout(store.limiter({ prefix: `testpw${prefix}`, ...LOCKOUT })) }));
    const email = `admin.${prefix}@example.in`;
    const [user] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Asha Rao', 'active', $2, now(), 'admin') returning id`, [email, await passwords.hash(PASSWORD)]);
    const userId = user?.id ?? '';
    const device = `test ${prefix}`;
    // One browser: what it holds of each cookie, kept as the handler would set and clear them.
    const jar = { session: null as string | null, pending: null as string | null };
    const cookie = () => ({ device, incoming: jar.session, set: (t: string) => { jar.session = t; },
      clear: () => { jar.session = null; },
      pending: { incoming: jar.pending, set: (t: string) => { jar.pending = t; }, clear: () => { jar.pending = null; } } });
    const withCookie = (ctx: Ctx): Ctx => ({ ...ctx, cookie: cookie() });
    const me = (): Principal => ({ kind: 'user', userId, permissions: ['session:read'] });
    // A route as the handler runs it: its `before` step outside any transaction (with its own short read-only one),
    // then the service in one. A RecordedRefusal's transaction commits, then the refusal is thrown on.
    const route = async <I, B, R>(principal: Principal, before: (i: I, d: BeforeDeps) => Promise<B>,
      service: (ctx: Ctx, i: I, m: { before: B }) => Promise<R>, input: I, between?: () => Promise<unknown>): Promise<R> => {
      const deps: BeforeDeps = { secrets, principal, cookie: cookie(),
        read: (work) => runInTransaction(db, read, principal, 'req-2fa', (ctx) => work(withCookie(ctx))) };
      const meta = { before: await before(input, deps) };
      await between?.();
      let refused: RecordedRefusal | null = null;
      const answer = await run(principal, (ctx) => service(withCookie(ctx), input, meta).catch((e: unknown) => {
        if (!(e instanceof RecordedRefusal)) throw e;
        refused = e;
        return null;
      }));
      if (refused !== null) throw refused;
      return answer as R;
    };
    const start = () => route(PUBLIC, factor.sealForEnrolment, factor.startEnrolment, {});
    const confirm = (code: string) => route(PUBLIC, factor.openForConfirm, factor.confirmEnrolment, { code });
    const verify = (input: { kind: 'totp'; code: string } | { kind: 'recovery'; code: string }, between?: () => Promise<unknown>) =>
      route(PUBLIC, factor.openForVerify, factor.verify, input, between);
    const newCodes = (code: string, as: Principal = me()) => route(as, factor.openForNewCodes, factor.newRecoveryCodes, { code });
    const password = () => run(PUBLIC, (ctx) => signIn(withCookie(ctx), { email, password: PASSWORD }));
    const events = async () => asAdmin<{ kind: string; detail: Record<string, unknown> }>(
      'select kind, detail from radcore.event_log where user_id = $1 order by occurred_at, seq', [userId]);
    const sessionsOf = async () => asAdmin<{ token_hash: string }>('select token_hash from radcore.sessions where user_id = $1', [userId]);
    // Sign in with the password, enrol, and confirm with the first code: the new codes and the secret.
    const enrol = async () => {
      await password();
      const { otpauthUri } = await start();
      const secret = (URI.parse(otpauthUri) as { secret: Secret }).secret.base32;
      const { recoveryCodes } = await confirm(codeAt(secret, clock.now()));
      return { secret, recoveryCodes };
    };
    return { factor, clock, email, userId, jar, password, events, sessionsOf, me, enrol, start, confirm, verify, newCodes };
  }

  it('gives a person who must have a factor but has none only a pending sign-in after the password', async () => {
    const s = await setup();
    expect(await s.password()).toEqual({ next: 'enrol_second_factor' });
    expect([s.jar.session, s.jar.pending]).toEqual([null, expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)]);
    const [pending] = await asAdmin<{ token_hash: string; minutes: number }>(`select token_hash,
      round(extract(epoch from expires_at - created_at) / 60)::int as minutes from radcore.pending_sign_ins where user_id = $1`, [s.userId]);
    expect([pending?.token_hash, pending?.minutes]).toEqual([sha256(s.jar.pending ?? ''), 5]);
    expect(await s.sessionsOf()).toEqual([]);
  });

  it('enrols during sign-in: the URI, the first code, ten recovery codes, and a session', async () => {
    const s = await setup();
    await s.password();
    const { otpauthUri } = await s.start();
    const totp = URI.parse(otpauthUri) as { issuer: string; label: string; algorithm: string; digits: number; period: number; secret: Secret };
    expect([totp.issuer, totp.label, totp.algorithm, totp.digits, totp.period, totp.secret.bytes.length])
      .toEqual(['RadCore', s.email, 'SHA1', 6, 30, 20]);
    // Kept sealed by the secrets library, never as it is.
    const [stored] = await asAdmin<{ secret: string; confirmed: boolean }>(
      'select secret, confirmed_at is not null as confirmed from radcore.second_factors where user_id = $1', [s.userId]);
    expect([stored?.secret.includes(totp.secret.base32), stored?.confirmed]).toEqual([false, false]);
    expect(await outcome(s.confirm('000000'))).toBe('second_factor_invalid');
    const { recoveryCodes } = await s.confirm(codeAt(totp.secret.base32, s.clock.now()));
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
    const hashes = await asAdmin<{ code_hash: string }>('select code_hash from radcore.recovery_codes where user_id = $1', [s.userId]);
    expect(hashes.map((h) => h.code_hash.startsWith('$argon2id$'))).toEqual(Array<boolean>(10).fill(true));
    expect([s.jar.pending, (await s.sessionsOf()).map((r) => r.token_hash)]).toEqual([null, [sha256(s.jar.session ?? '')]]);
    expect(await run(s.me(), (ctx) => secondFactorStatus(ctx, s.userId))).toBe('enrolled');
    // A second confirm finds the pending sign-in spent.
    expect(await outcome(s.confirm('123456'))).toBe('sign_in_expired');
    expect(await s.events()).toEqual([{ kind: 'second_factor_changed', detail: { change: 'enrolled' } }, { kind: 'sign_in', detail: {} }]);
  });

  it('asks an enrolled person for a code, and takes each code once', async () => {
    const s = await setup();
    const { secret } = await s.enrol();
    s.clock.advance(60_000);
    expect(await s.password()).toEqual({ next: 'second_factor' });
    const code = codeAt(secret, s.clock.now());
    expect(await outcome(s.verify({ kind: 'totp', code }))).toBe('ok');
    expect((await s.sessionsOf())).toHaveLength(2);
    // The same code again, on a new sign-in within its 30 seconds, is refused, and the refusal is recorded.
    await s.password();
    expect(await outcome(s.verify({ kind: 'totp', code }))).toBe('recorded:second_factor_invalid');
    expect((await s.events()).at(-1)).toEqual({ kind: 'sign_in_failed', detail: { reason: 'second_factor' } });
    // A code a step on works; one from two steps ago doesn't.
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, new Date(s.clock.now().getTime() - 60_000)) }))).toBe('recorded:second_factor_invalid');
    s.clock.advance(30_000);
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })))
      .toBe('ok');
  });

  it('takes a recovery code once, however it is typed, in place of a TOTP code', async () => {
    const s = await setup();
    const { recoveryCodes } = await s.enrol();
    const [first = ''] = recoveryCodes;
    await s.password();
    expect(await outcome(s.verify({ kind: 'recovery', code: ` ${first.toUpperCase().replaceAll('-', ' ')} ` })))
      .toBe('ok');
    await s.password();
    expect(await outcome(s.verify({ kind: 'recovery', code: first })))
      .toBe('recorded:second_factor_invalid');
    expect((await asAdmin<{ used: number }>('select count(*)::int as used from radcore.recovery_codes where user_id = $1 and used_at is not null',
      [s.userId]))[0]?.used).toBe(1);
  });

  // ADR-001 §8: the secret was opened outside the transaction, so the service checks the row still holds what was read.
  it('refuses with conflict when the factor changes between the before step and the service', async () => {
    const s = await setup();
    const { secret } = await s.enrol();
    s.clock.advance(60_000);
    await s.password();
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) }, async () =>
      asAdmin("update radcore.second_factors set secret = secret || 'x' where user_id = $1", [s.userId])))).toBe('conflict');
  });

  it('refuses a missing, spent or expired pending sign-in', async () => {
    const s = await setup();
    const { secret } = await s.enrol();
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })))
      .toBe('sign_in_expired');
    await s.password();
    await asAdmin("update radcore.pending_sign_ins set expires_at = now() - interval '1 second' where token_hash = $1", [sha256(s.jar.pending ?? '')]);
    s.clock.advance(30_000);
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })))
      .toBe('sign_in_expired');
  });

  it('locks the account after five wrong codes, even for the right one, and records the lock', async () => {
    const s = await setup();
    const { secret } = await s.enrol();
    s.clock.advance(60_000);
    await s.password();
    for (let i = 0; i < SECOND_FACTOR_ATTEMPTS.points; i += 1) {
      expect(await outcome(s.verify({ kind: 'totp', code: '000000' })))
        .toBe('recorded:second_factor_invalid');
    }
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })))
      .toBe('recorded:account_locked');
    expect((await s.events()).at(-1)).toEqual({ kind: 'sign_in_failed', detail: { reason: 'account_locked' } });
  });

  it('makes new recovery codes for a signed-in person with a current code; the old ones stop working', async () => {
    const s = await setup();
    const { secret, recoveryCodes: old } = await s.enrol();
    s.clock.advance(60_000);
    expect(await outcome(s.newCodes('000000'))).toBe('second_factor_invalid');
    const { recoveryCodes } = await s.newCodes(codeAt(secret, s.clock.now()));
    expect(recoveryCodes.filter((c) => old.includes(c))).toEqual([]);
    await s.password();
    expect(await outcome(s.verify({ kind: 'recovery', code: old[0] ?? '' })))
      .toBe('recorded:second_factor_invalid');
    expect(await outcome(s.verify({ kind: 'recovery', code: recoveryCodes[0] ?? '' }))).toBe('ok');
    expect((await s.events()).filter((e) => e.kind === 'second_factor_changed').map((e) => e.detail))
      .toEqual([{ change: 'enrolled' }, { change: 'recovery_codes' }]);
    const other = await setup();
    expect(await outcome(other.newCodes('123456'))).toBe('no_second_factor');
  });

  it("lets an admin remove someone else's factor, so they enrol again, but not their own", async () => {
    const s = await setup();
    await s.enrol();
    const admin: Principal = { kind: 'user', userId: (await setup()).userId, permissions: ['users:write'] };
    const reason = 'Lost their phone';
    expect(await outcome(run(s.me(), (ctx) => s.factor.remove(ctx, { id: s.userId, reason })))).toBe('own_account');
    expect(await outcome(run(admin, (ctx) => s.factor.remove(ctx, { id: s.userId, reason })))).toBe('ok');
    expect(await asAdmin('select 1 from radcore.recovery_codes where user_id = $1', [s.userId])).toEqual([]);
    expect(await run(s.me(), (ctx) => secondFactorStatus(ctx, s.userId))).toBe('enrolment_required');
    expect(await s.password()).toEqual({ next: 'enrol_second_factor' });
    expect(await outcome(run(admin, (ctx) => s.factor.remove(ctx, { id: s.userId, reason })))).toBe('no_second_factor');
    expect((await s.events()).filter((e) => e.kind === 'second_factor_changed').map((e) => e.detail))
      .toEqual([{ change: 'enrolled' }, { change: 'removed' }]);
  });

  it('answers /me with the person enrolled', async () => {
    const s = await setup();
    await s.enrol();
    const [session] = await asAdmin<{ id: string }>('select id from radcore.sessions where user_id = $1', [s.userId]);
    const signedIn: Principal = { kind: 'user', userId: s.userId, permissions: ['session:read'], sessionId: session?.id ?? '' };
    expect((await run(signedIn, getMyself)).secondFactor).toBe('enrolled');
  });

  // RAD-31's register: each second-factor route writes exactly the kinds SECURITY_EVENT_ROUTES lists for it.
  it('writes the security events SECURITY_EVENT_ROUTES lists for each second-factor route, and no others', async () => {
    const s = await setup();
    const admin: Principal = { kind: 'user', userId: (await setup()).userId, permissions: ['users:write'] };
    const written: Record<string, Set<string>> = {};
    const seen = async (route: string, step: () => Promise<unknown>) => {
      const before = (await s.events()).length;
      await step();
      written[route] ??= new Set();
      for (const e of (await s.events()).slice(before)) written[route].add(e.kind);
    };
    await s.password();
    const { otpauthUri } = await s.start();
    const secret = (URI.parse(otpauthUri) as { secret: Secret }).secret.base32;
    await seen('POST /sign-in/second-factor/enrolment/confirm', () => s.confirm(codeAt(secret, s.clock.now())));
    s.clock.advance(30_000);
    await s.password();
    await seen('POST /sign-in/second-factor', () => outcome(s.verify({ kind: 'totp', code: '000000' })));
    await seen('POST /sign-in/second-factor', () => outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })));
    s.clock.advance(30_000);
    await seen('POST /me/second-factor/recovery-codes', () => s.newCodes(codeAt(secret, s.clock.now())));
    await seen('POST /admin/users/:id/second-factor/remove', () => run(admin, (ctx) => s.factor.remove(ctx, { id: s.userId, reason: 'Lost phone' })));
    // Every kind written is listed; every listed kind was written, but session_ended where no session came before.
    const listed = (r: string): readonly string[] => SECURITY_EVENT_ROUTES[r as keyof typeof SECURITY_EVENT_ROUTES];
    for (const [r, kinds] of Object.entries(written)) {
      expect([r, [...kinds].filter((k) => !listed(r).includes(k))]).toEqual([r, []]);
      expect([r, listed(r).filter((k) => !kinds.has(k) && !(k === 'session_ended' && r.endsWith('/confirm')))]).toEqual([r, []]);
    }
    expect(Object.keys(written)).toHaveLength(4);
  });

  it('never puts a secret or a code in a security event', async () => {
    const s = await setup();
    const { secret, recoveryCodes } = await s.enrol();
    const text = JSON.stringify(await asAdmin('select * from radcore.event_log where user_id = $1', [s.userId]));
    for (const value of [secret, ...recoveryCodes, codeAt(secret, s.clock.now())]) expect(text).not.toContain(value);
  });

  it('gives tests a person already enrolled (the fixture), whose codes the verify step takes', async () => {
    const s = await setup();
    const secret = await enrolTestUser(async (text, values) => asAdmin(text, values), s.userId, cfg.secrets);
    expect(await s.password()).toEqual({ next: 'second_factor' });
    expect(await outcome(s.verify({ kind: 'totp', code: codeAt(secret, s.clock.now()) })))
      .toBe('ok');
  });
});
