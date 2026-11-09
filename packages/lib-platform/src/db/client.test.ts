// RC-078: a lost database connection doesn't end the process; and the health ping really reaches the database.
import { describe, expect, it, vi } from 'vitest';
import { createHealthCheck, createPool, ping } from './client.ts';

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

// A probe the test settles by hand, counting how many connections the health check would have opened.
const handProbe = () => {
  const settle: { ok: () => void; fail: (e: Error) => void }[] = [];
  const probe = vi.fn(() => new Promise<void>((ok, fail) => { settle.push({ ok, fail }); }));
  return { probe, settle };
};

describe('createHealthCheck', () => {
  it('makes one connection for any number of concurrent checks', async () => {
    const { probe, settle } = handProbe();
    const check = createHealthCheck(db('postgres://h/x'), { probe, now: () => 0 });
    const calls = Array.from({ length: 50 }, () => check());
    expect(probe).toHaveBeenCalledTimes(1);
    settle[0]?.ok();
    await expect(Promise.all(calls)).resolves.toHaveLength(50);
  });

  it('reuses a settled result for ttlMs, success or failure, then checks again', async () => {
    const { probe, settle } = handProbe();
    const clock = { t: 0 };
    const check = createHealthCheck(db('postgres://h/x'), { probe, ttlMs: 1500, now: () => clock.t });
    const first = check();
    settle[0]?.fail(new Error('connection refused'));
    await expect(first).rejects.toThrow('connection refused');
    clock.t = 1499;
    await expect(check()).rejects.toThrow('connection refused');
    expect(probe).toHaveBeenCalledTimes(1);
    clock.t = 1500;
    const second = check();
    expect(probe).toHaveBeenCalledTimes(2);
    settle[1]?.ok();
    await expect(second).resolves.toBeUndefined();
  });
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
