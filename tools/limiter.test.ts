// RAD-32 (M1-14, RC-089, ADR-003): the shared rate-limit store on a real PostgreSQL, as the runtime login, and the
// sign-in lockout built on it. Each test uses its own key prefix, so the shuffled order doesn't matter.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '@radcore/lib-platform';
import { testPassword, testRateLimitKey, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
// Collecting a skipped suite still builds its store; a pool connects only when used, so this is never reached.
const NO_DATABASE = 'postgres://unused@127.0.0.1:1/unused';
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
// The test server uses trust auth; the settings check wants a password, which the server ignores.
const database = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api').database;
};
const prefix = () => `test${randomBytes(4).toString('hex')}`;
// The store's rows, read as the superuser: the runtime login reaches them only through the store.
async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: superUrl });
  await c.connect();
  try {
    return (await c.query<T>(text, values)).rows;
  } finally {
    await c.end();
  }
}
// What the store keeps for a key: its HMAC under the store's secret (RAD-73).
const hmac = (secret: string, key: string) => createHmac('sha256', Buffer.from(secret, 'base64')).update(key).digest('hex');
const log = { info: () => undefined, error: () => undefined };

describe.skipIf(!url)('the shared rate-limit store', () => {
  const store = createLimiterStore(database(url ?? NO_DATABASE), log, testRateLimitKey());
  afterAll(() => store.end());

  // RAD-73: a key is stored as its HMAC under RATE_LIMIT_KEY, so the table can't be read back into addresses.
  it('stores each key as its HMAC: the same under one secret, different under another, never the input', async () => {
    const p = prefix();
    const other = createLimiterStore(database(url ?? NO_DATABASE), log, Buffer.alloc(32, 4).toString('base64url'));
    const email = `email:asha.${randomBytes(3).toString('hex')}@example.in`;
    try {
      const spec = { prefix: p, points: 5, windowSeconds: 60, blockSeconds: 60 };
      await store.limiter(spec).hit(email);
      await store.limiter(spec).hit(email);
      await other.limiter(spec).hit(email);
      const rows = await asAdmin<{ key: string; points: number }>('select key, points from ratelimit.limits where key like $1 order by key',
        [`${p}:%`]);
      // One secret: both hits on one key. Another: a key of its own.
      expect(rows.toSorted((a, b) => a.points - b.points)).toEqual([
        { key: `${p}:${hmac(Buffer.alloc(32, 4).toString('base64url'), email)}`, points: 1 },
        { key: `${p}:${hmac(testRateLimitKey(), email)}`, points: 2 }]);
      expect(JSON.stringify(rows)).not.toContain('asha');
      expect(rows.map((r) => r.key)).not.toContain(`${p}:${createHash('sha256').update(email).digest('hex')}`);
    } finally {
      await other.end();
    }
  });

  it('lets a key through until its points are used, then holds it for the block', async () => {
    const limiter = store.limiter({ prefix: prefix(), points: 3, windowSeconds: 60, blockSeconds: 120 });
    expect([await limiter.hit('a'), await limiter.hit('a'), await limiter.hit('a')]).toEqual([0, 0, 0]);
    expect(await limiter.wait('a')).toBe(0);
    const held = await limiter.hit('a');
    expect(held).toBeGreaterThan(110);
    expect(held).toBeLessThanOrEqual(120);
    expect(await limiter.wait('a')).toBe(held);
    // Another key, and the same key under another prefix, are counted apart.
    expect(await limiter.wait('b')).toBe(0);
    expect(await store.limiter({ prefix: prefix(), points: 3, windowSeconds: 60, blockSeconds: 120 }).wait('a')).toBe(0);
    await limiter.reset('a');
    expect(await limiter.wait('a')).toBe(0);
  });

  // ADR-003: when the store can't be reached, a limited action is refused for the whole block.
  it('fails closed when the store does not answer', async () => {
    const down = createLimiterStore(database(`postgres://radcore:${testPassword()}@127.0.0.1:1/radcore`), log, testRateLimitKey());
    try {
      const limiter = down.limiter({ prefix: prefix(), points: 3, windowSeconds: 60, blockSeconds: 120 });
      expect([await limiter.wait('a'), await limiter.hit('a')]).toEqual([120, 120]);
    } finally {
      await down.end();
    }
  });

  it('keeps no email address in the store, only its HMAC', async () => {
    const p = prefix();
    const lockout = createLockout(store.limiter({ prefix: p, ...LOCKOUT }));
    const email = `Asha.${randomBytes(3).toString('hex')}@Example.in`;
    await lockout.attempt(email);
    expect(await asAdmin('select key from ratelimit.limits where key like $1', [`${p}:%`]))
      .toEqual([{ key: `${p}:${hmac(testRateLimitKey(), `email:${email.trim().toLowerCase()}`)}` }]);
    expect(JSON.stringify(await asAdmin('select key from ratelimit.limits'))).not.toMatch(/asha/i);
  });

  // RAD-64: 10 attempts per address; the 11th is refused and the lock ends on its own. The numbers are production's.
  it('lets 10 attempts through for an address, whatever its case, refuses the 11th, and starts again after a success', async () => {
    expect(LOCKOUT).toEqual({ points: 10, windowSeconds: 900, blockSeconds: 900 });
    const lockout = createLockout(store.limiter({ prefix: prefix(), ...LOCKOUT }));
    const email = `ravi.${randomBytes(3).toString('hex')}@example.in`;
    const waits: number[] = [];
    for (let i = 0; i < LOCKOUT.points; i++) waits.push(await lockout.attempt(i % 2 === 0 ? email : ` ${email.toUpperCase()} `));
    expect(waits).toEqual(Array(LOCKOUT.points).fill(0));
    expect(await lockout.attempt(email)).toBeGreaterThan(890);
    await lockout.succeeded(email);
    expect(await lockout.attempt(email)).toBe(0);
  });

  // The auditor's MUST on #82: counting before the check means a burst can't all pass a check made before any counted.
  it('lets at most 10 of 20 parallel attempts on one address through', async () => {
    const lockout = createLockout(store.limiter({ prefix: prefix(), ...LOCKOUT }));
    const email = `burst.${randomBytes(3).toString('hex')}@example.in`;
    const waits = await Promise.all(Array.from({ length: 20 }, () => lockout.attempt(email)));
    expect(waits.filter((w) => w === 0)).toHaveLength(LOCKOUT.points);
  });
});
