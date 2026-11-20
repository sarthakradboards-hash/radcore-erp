// A party edit and a cash save for the same party never deadlock (ADR-006 §1 step 3; the auditor on #260). A save
// holds the party's KEY SHARE from its own insert, then waits in holdParty (NO KEY UPDATE). An edit that changes the
// GSTIN, a unique key column, upgrades its row lock to FOR UPDATE, which waits on that KEY SHARE: so it takes FOR UPDATE
// from the start, and waits before it holds anything the save needs.
import { randomBytes, randomUUID } from 'node:crypto';
import { changeParty } from '@radcore/lib-accounts';
import { gstinCheckChar } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const digits = (n: number) => [...randomBytes(n)].map((b) => String(b % 10)).join('');
/** A GSTIN no other test holds: state 27, a firm's PAN, its check character. */
const gstin = () => {
  const first14 = `27${letters(3)}F${letters(1)}${digits(4)}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the party lock test must run, not skip');
});

describe.skipIf(!url || !superUrl)('a party edit and a save for the party at once', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, AS, randomUUID(), fn);

  it('changes the GSTIN without deadlocking a save that holds the party’s KEY SHARE and then holds the party', async () => {
    const c = await su.connect();
    let id = '';
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      id = (await c.query<{ id: string }>("insert into radcore.parties (name, customer, state_code) values ($1, true, '27') returning id",
        [`Lock party ${randomUUID()}`])).rows[0]?.id ?? '';
      await c.query('commit');
    } finally {
      c.release();
    }
    const save = await su.connect();
    try {
      await save.query('begin');
      // The save's insert: KEY SHARE on the party, through its foreign key.
      await save.query('select id from radcore.parties where id = $1 for key share', [id]);
      const pid = (await save.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const edit = run((ctx) => changeParty(ctx, { id, gstin: gstin() })).then(() => 'ok', (e: unknown) => String((e as { code?: string }).code ?? e));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.n).toBe(1), { timeout: 10_000 });
      // Then the save holds the party (holdParty): with the edit waiting before it holds anything, this doesn't wait.
      const held = await save.query('select id from radcore.parties where id = $1 for no key update', [id]).then(() => 'ok', (e: unknown) =>
        String((e as { code?: string }).code));
      await save.query('commit');
      expect([held, await edit]).toEqual(['ok', 'ok']);
    } finally {
      await save.query('rollback').catch(() => undefined);
      save.release();
    }
  });
});
