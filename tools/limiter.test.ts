// RAD-32 (M1-14, RC-089, ADR-003): the shared rate-limit store on a real PostgreSQL, as the runtime login, and the
// sign-in lockout built on it. Each test uses its own key prefix, so the shuffled order doesn't matter.
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '@radcore/lib-platform';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createLockout, LOCKOUT } from '../packages/lib-platform/src/auth/lockout.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
// The test server uses trust auth; the settings check wants a password, which the server ignores.
const database = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api').database;
};
const prefix = () => `test${randomBytes(4).toString('hex')}`;
const log = { info: () => undefined, error: () => undefined };

describe.skipIf(!url)('the shared rate-limit store', () => {
  const store = createLimiterStore(database(url ?? ''), log);
  afterAll(() => store.end());

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
    const down = createLimiterStore(database(`postgres://radcore:${testPassword()}@127.0.0.1:1/radcore`), log);
    try {
      const limiter = down.limiter({ prefix: prefix(), points: 3, windowSeconds: 60, blockSeconds: 120 });
      expect([await limiter.wait('a'), await limiter.hit('a')]).toEqual([120, 120]);
    } finally {
      await down.end();
    }
  });

  it('keeps no email address in the store, only its hash', async () => {
    const lockout = createLockout(store.limiter({ prefix: prefix(), ...LOCKOUT }));
    const email = `Asha.${randomBytes(3).toString('hex')}@Example.in`;
    await lockout.failed(email);
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    try {
      const { rows } = await c.query<{ key: string }>('select key from ratelimit.limits where key like $1',
        [`%${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`]);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify((await c.query('select key from ratelimit.limits')).rows)).not.toMatch(/asha/i);
    } finally {
      await c.end();
    }
  });

  // RAD-64: a lock is short and ends on its own; a reset or a success clears it. The numbers are production's.
  it('locks an address after its failures, whatever its case, and clears on success', async () => {
    expect(LOCKOUT).toEqual({ points: 10, windowSeconds: 900, blockSeconds: 900 });
    const lockout = createLockout(store.limiter({ prefix: prefix(), ...LOCKOUT }));
    const email = `ravi.${randomBytes(3).toString('hex')}@example.in`;
    for (let i = 0; i < LOCKOUT.points; i++) await lockout.failed(email);
    expect(await lockout.lockedFor(email.toUpperCase())).toBe(0);
    expect(await lockout.failed(` ${email.toUpperCase()} `)).toBeGreaterThan(890);
    expect(await lockout.lockedFor(email)).toBeGreaterThan(890);
    await lockout.clear(email);
    expect(await lockout.lockedFor(email)).toBe(0);
  });
});
