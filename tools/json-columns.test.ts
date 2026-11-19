// RAD-98 (auditor-2 on #197): every jsonb column is columns.ts's json(), which reads node-pg's value once. drizzle's
// jsonb() parsed a string value a second time, so a bare "2024" came back as 2024 and "null" as null. Each column that
// can hold a top-level string round-trips one here. Every write is rolled back: a committed outbox row would be taken
// by the relay of another test file running at once.
import { randomUUID } from 'node:crypto';
import { jobsOutbox, platformTx, savedOnce } from '@radcore/db/platform';
import type { Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const BARE = ['2024', 'null', 'true', '{"a":1}'];

class Rollback extends Error {}

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the json column tests must run, not skip');
});

describe.skipIf(!url)('json columns read a bare string as that string', () => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  // Runs fn in a transaction, keeps what it read, and rolls everything back.
  async function readBack<T>(fn: (tx: ReturnType<typeof platformTx>) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await runInTransaction(db, write, AS, randomUUID(), async (ctx) => {
      out = await fn(platformTx(ctx));
      throw new Rollback();
    }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    return out as T;
  }

  it('in a job’s data (jobs_outbox)', async () => {
    const read = await readBack(async (tx) => {
      const got: unknown[] = [];
      for (const data of BARE) {
        const [row] = await tx.insert(jobsOutbox).values({ name: 'test.json', data, principal: 'system:test', requestId: randomUUID() })
          .returning({ id: jobsOutbox.id });
        got.push((await tx.select({ data: jobsOutbox.data }).from(jobsOutbox).where(eq(jobsOutbox.id, row?.id ?? '')))[0]?.data);
      }
      return got;
    });
    expect(read).toEqual(BARE);
  });

  it('in a saved answer (saved_once)', async () => {
    const read = await readBack(async (tx) => {
      const got: unknown[] = [];
      for (const answer of BARE) {
        const key = randomUUID();
        await tx.insert(savedOnce).values({ principal: 'system:test', route: 'POST /test', key, inputHash: '0'.repeat(64), answer,
          expiresAt: new Date('2099-01-01T00:00:00Z') });
        got.push((await tx.select({ answer: savedOnce.answer }).from(savedOnce).where(eq(savedOnce.key, key)))[0]?.answer);
      }
      return got;
    });
    expect(read).toEqual(BARE);
  });
  // A null-able json() column given null stores SQL NULL, not the jsonb value null: drizzle skips the encoder for a null
  // parameter (auditor-2 on #197). Read back through drizzle the two look alike, so SQL tells them apart.
  it('stores a null answer as SQL NULL (saved_once)', async () => {
    const key = randomUUID();
    await runInTransaction(db, write, AS, randomUUID(), async (ctx) => {
      await platformTx(ctx).insert(savedOnce).values({ principal: 'system:test', route: 'POST /test', key, inputHash: '0'.repeat(64),
        answer: null, expiresAt: new Date('2099-01-01T00:00:00Z') });
    });
    try {
      const { rows } = await pool.query<{ n: boolean; t: string | null }>(
        'select answer is null as n, jsonb_typeof(answer) as t from radcore.saved_once where key = $1', [key]);
      expect(rows).toEqual([{ n: true, t: null }]);
    } finally {
      await runInTransaction(db, write, AS, randomUUID(), async (ctx) => { await platformTx(ctx).delete(savedOnce).where(eq(savedOnce.key, key)); });
    }
  });
});
