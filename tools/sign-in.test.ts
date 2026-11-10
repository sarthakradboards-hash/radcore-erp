// RAD-32 (M1-14, ADR-001 §7a, RAD-64): the credential step of sign-in on a real PostgreSQL, as the runtime login.
// A locked address is refused before any check; an unknown address and a wrong password get the same answer, are
// checked against a hash the same way and are counted the same way; a success clears the count and rehashes an old hash.
// RAD-34 wires this to the /sign-in route and the session cookie. Each test makes its own user and lockout prefix.
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { AppError, loadConfig, type Ctx } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createPasswords } from '../packages/lib-platform/src/auth/passwords.ts';
import { createSignIn } from '../packages/lib-platform/src/auth/sign-in.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const database = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api').database;
};
const log = { info: () => undefined, error: () => undefined };
const write = { readOnly: false, isolation: 'read committed' } as const;
const PASSWORD = 'a quiet harbour at dawn';

describe.skipIf(!url)('the sign-in credential step', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const store = createLimiterStore(database(url ?? ''), log);
  afterAll(async () => {
    await store.end();
    await pool.end();
  });

  // A user as an admin's invite and the person's own password would leave it, through the superuser.
  async function addUser(status: 'active' | 'invited', passwordHash: string | null) {
    const email = `user.${randomBytes(4).toString('hex')}@example.in`;
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows: [u] } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
        password_set_at) values ($1, 'Test', $2, $3, case when $3::text is null then null else now() end) returning id`,
      [email, status, passwordHash]);
      await c.query('commit');
      return { email, id: u?.id ?? '' };
    } finally {
      await c.end();
    }
  }
  const storedHash = async (id: string) => {
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    try {
      return (await c.query<{ h: string }>('select password_hash as h from radcore.users where id = $1', [id])).rows[0]?.h;
    } finally {
      await c.end();
    }
  };
  // A sign-in service on its own lockout prefix, with every collaborator observable.
  async function service(secondFactor: 'not_required' | 'enrolled' | 'enrolment_required' = 'not_required') {
    const real = await createPasswords();
    // The real check, watched: the service's object is frozen, so it's wrapped rather than spied on.
    const verify = vi.fn(real.verify);
    const passwords = { ...real, verify };
    const lockout = createLockout(store.limiter({ prefix: `test${randomBytes(4).toString('hex')}`, ...LOCKOUT }));
    const signIn = createSignIn({ passwords, lockout, secondFactor: async () => secondFactor });
    const run = (email: string, password: string) => runInTransaction(db, write,
      { kind: 'system', name: 'public', permissions: [] }, 'req-1', (ctx: Ctx) => signIn(ctx, { email, password }));
    const failure = (email: string, password: string) => run(email, password).then(() => 'ok',
      (e: unknown) => (e instanceof AppError ? e.code : String(e)));
    return { passwords, verify, lockout, run, failure };
  }

  it('signs in with the right password, whatever the address case, and clears earlier failures', async () => {
    const s = await service();
    const user = await addUser('active', await s.passwords.hash(PASSWORD));
    await s.lockout.failed(user.email);
    expect(await s.run(` ${user.email.toUpperCase()} `, PASSWORD)).toEqual({ userId: user.id, next: 'done' });
    for (let i = 0; i < LOCKOUT.points; i++) await s.lockout.failed(user.email);
    expect(await s.lockout.lockedFor(user.email)).toBe(0);
  });

  it('answers a second factor for a person whose role needs one (D-19)', async () => {
    for (const [status, next] of [['enrolled', 'second_factor'], ['enrolment_required', 'enrol_second_factor']] as const) {
      const s = await service(status);
      const user = await addUser('active', await s.passwords.hash(PASSWORD));
      expect(await s.run(user.email, PASSWORD)).toEqual({ userId: user.id, next });
    }
  });

  // RAD-64: nothing tells anyone an account exists.
  it('answers a wrong password, an unknown address and an invited person alike, each checked and counted', async () => {
    const s = await service();
    const active = await addUser('active', await s.passwords.hash(PASSWORD));
    const invited = await addUser('invited', null);
    const unknown = `nobody.${randomBytes(4).toString('hex')}@example.in`;
    expect([await s.failure(active.email, 'wrong password, long enough'), await s.failure(unknown, PASSWORD),
      await s.failure(invited.email, PASSWORD)]).toEqual(['invalid_credentials', 'invalid_credentials', 'invalid_credentials']);
    // The unknown and the invited are checked against the dummy, so each costs one full verify.
    expect(s.verify.mock.calls.map(([stored]) => stored === null)).toEqual([false, true, true]);
    // Each sign-in counted one failure: LOCKOUT.points more go past the allowance and lock all three alike.
    for (const email of [active.email, unknown, invited.email]) {
      for (let i = 0; i < LOCKOUT.points; i++) await s.lockout.failed(email);
      expect(await s.lockout.lockedFor(email)).toBeGreaterThan(0);
    }
  });

  it('refuses a locked address before checking anything, saying when to retry', async () => {
    const s = await service();
    const user = await addUser('active', await s.passwords.hash(PASSWORD));
    for (let i = 0; i <= LOCKOUT.points; i++) await s.lockout.failed(user.email);
    const refused = await s.run(user.email, PASSWORD).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AppError);
    expect([(refused as AppError).code, (refused as AppError).retryAfterSeconds]).toEqual(['account_locked', expect.any(Number)]);
    expect((refused as AppError).retryAfterSeconds).toBeGreaterThan(890);
    expect(s.verify).not.toHaveBeenCalled();
  });

  it('rehashes a password stored with older parameters, on a successful sign-in', async () => {
    const s = await service();
    const user = await addUser('active', await hash(PASSWORD, { algorithm: 2, memoryCost: 4096, timeCost: 1, parallelism: 1 }));
    expect(await s.run(user.email, PASSWORD)).toEqual({ userId: user.id, next: 'done' });
    expect(await storedHash(user.id)).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});
