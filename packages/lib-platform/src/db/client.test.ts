// RC-078: a lost database connection doesn't end the process; and the health ping really reaches the database.
import { describe, expect, it, vi } from 'vitest';
import { createPool, ping } from './client.ts';

const db = (url: string) => ({ url, poolMax: 2, poolWaitMs: 2000, statementTimeoutMs: 1000, lockTimeoutMs: 1000,
  idleTxTimeoutMs: 1000 });
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });

it("survives a dropped connection's error, and logs it", async () => {
  const log = logger();
  const pool = createPool(db('postgres://radcore:x@127.0.0.1:1/radcore'), log);
  // Unhandled, an 'error' event throws: this is what a database restart does to an idle connection.
  expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
  expect(log.error).toHaveBeenCalledWith('database connection lost; the pool will reconnect', expect.any(Error));
  await pool.end();
});

it('ping fails when nothing answers', async () => {
  await expect(ping(db('postgres://radcore:x@127.0.0.1:1/radcore'))).rejects.toThrow();
});

const url = process.env['TEST_DATABASE_URL'];
describe.skipIf(!url)('with the test database', () => {
  it('ping succeeds when the database answers', async () => {
    await expect(ping(db(url ?? ''))).resolves.toBeUndefined();
  });

  it('pool connections carry the three timeouts (ADR-002 §4)', async () => {
    const pool = createPool(db(url ?? ''), logger());
    try {
      const client = await pool.connect();
      client.release();
      expect(pool.options).toMatchObject({ statement_timeout: 1000, lock_timeout: 1000,
        idle_in_transaction_session_timeout: 1000 });
    } finally {
      await pool.end();
    }
  });
});
