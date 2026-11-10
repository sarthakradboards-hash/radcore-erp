// RAD-32 (M1-14, RC-045, RC-090) on a real PostgreSQL: the users table and the one-time link tables. Each test acts
// as a login with SET ROLE inside a transaction it rolls back, so it leaves nothing.
import { createHash, randomBytes } from 'node:crypto';
import { normaliseEmail } from '@radcore/lib-common';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

// A superuser on the test database, so each test can switch logins (tools/test-database.ts).
const url = process.env['TEST_DATABASE_SUPERUSER_URL'];

async function inRollback(fn: (c: pg.Client) => Promise<void>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("set local app.principal = 'system:test'");
    await fn(c);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}
// The SQLSTATE a statement fails with, or 'ok', under a savepoint so the transaction goes on.
async function outcome(c: pg.Client, text: string, values: unknown[] = []): Promise<string> {
  await c.query('savepoint s');
  try {
    await c.query(text, values);
    await c.query('release savepoint s');
    return 'ok';
  } catch (error) {
    await c.query('rollback to savepoint s');
    return (error as { code?: string }).code ?? 'unknown';
  }
}
const addUser = 'insert into radcore.users (email, display_name) values ($1, $2) returning id';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe.skipIf(!url)('the users table', () => {
  it('keeps email unique ignoring case and surrounding spaces (RC-045)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      expect(await outcome(c, addUser, [normaliseEmail(' Asha.Rao@Example.IN '), 'Asha'])).toBe('ok');
      expect(await outcome(c, addUser, ['asha.rao@example.in', 'Asha again'])).toBe('23505');
      // Even an address stored without normaliseEmail collides on email_key.
      expect(await outcome(c, addUser, ['ASHA.RAO@EXAMPLE.IN ', 'Asha shouting'])).toBe('23505');
      expect(await outcome(c, addUser, ['ravi@example.in', 'Ravi'])).toBe('ok');
    });
  });

  it('has a password exactly when it is no longer invited', async () => {
    await inRollback(async (c) => {
      const set = "update radcore.users set status = $2, password_hash = $3, password_set_at = now() where id = $1";
      const { rows: [u] } = await c.query<{ id: string }>(addUser, ['meera@example.in', 'Meera']);
      expect(await outcome(c, set, [u?.id, 'invited', '$argon2id$v=19$m=19456,t=2,p=1$x$y'])).toBe('23514');
      expect(await outcome(c, set, [u?.id, 'active', null])).toBe('23514');
      expect(await outcome(c, set, [u?.id, 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y'])).toBe('ok');
      expect(await outcome(c, set, [u?.id, 'retired', '$argon2id$v=19$m=19456,t=2,p=1$x$y'])).toBe('23514');
    });
  });

  it('stores a link token only as its SHA-256, once', async () => {
    await inRollback(async (c) => {
      const { rows: [u] } = await c.query<{ id: string }>(addUser, ['kiran@example.in', 'Kiran']);
      const token = randomBytes(32).toString('base64url');
      const add = (table: string, hash: string) => outcome(c,
        `insert into radcore.${table} (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [u?.id, hash]);
      for (const table of ['invites', 'password_resets']) {
        expect(await add(table, token)).toBe('23514');
        expect(await add(table, sha256(token))).toBe('ok');
        expect(await add(table, sha256(token))).toBe('23505');
      }
    });
  });

  it('shows the read-only login no password hash and no link token, and the rest of a user', async () => {
    await inRollback(async (c) => {
      await c.query(addUser, ['dev@example.in', 'Dev']);
      await c.query('set local role radcore_read');
      expect({
        rest: await outcome(c, 'select id, email, display_name, status from radcore.users'),
        hash: await outcome(c, 'select password_hash from radcore.users'),
        star: await outcome(c, 'select * from radcore.users'),
        invites: await outcome(c, 'select token_hash from radcore.invites'),
        resets: await outcome(c, 'select token_hash from radcore.password_resets'),
      }).toEqual({ rest: 'ok', hash: '42501', star: '42501', invites: '42501', resets: '42501' });
    });
  });
});
