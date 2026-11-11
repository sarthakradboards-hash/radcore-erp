// RAD-31 (M1-13, RC-031, ADR-005 §7c): security events on a real PostgreSQL 16. v1 left every sign-in, password change
// and almost every export with no trace (RC-031); here each kind is written through record_event, as the request's
// principal, read back newest first, and can't be forged, changed or written another way.
// The SQL half runs as the superuser switching login with SET ROLE, in transactions that roll back. The library half
// runs as the app login; event_log is append-only, so its rows stay, and each test reads only its own account's.
import { randomUUID } from 'node:crypto';
import { type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { listSecurityEventsPage, recordSecurityEvent, type SecurityEvent } from '../packages/lib-platform/src/security-events.ts';

const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const appUrl = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !(superUrl && appUrl))('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_SUPERUSER_URL and TEST_DATABASE_URL must be set: in CI the security-event tests must run');
});

async function inRollback(fn: (c: pg.Client) => Promise<void>) {
  const c = new pg.Client({ connectionString: superUrl });
  await c.connect();
  try {
    await c.query('begin');
    await fn(c);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

// The SQLSTATE a statement fails with, or 'ok', under a savepoint so the transaction goes on.
async function outcome(c: pg.Client, text: string, params: unknown[] = []): Promise<string> {
  await c.query('savepoint s');
  try {
    await c.query(text, params);
    await c.query('release savepoint s');
    return 'ok';
  } catch (error) {
    await c.query('rollback to savepoint s');
    return (error as { code?: string }).code ?? 'unknown';
  }
}

const RECORD = 'select radcore.record_event($1, $2, $3, $4)';

describe.skipIf(!superUrl)('record_event', () => {
  it('appends an event as the request principal at the database time, for the app login only', async () => {
    await inRollback(async (c) => {
      const userId = randomUUID();
      await c.query("set local app.principal = 'system:public'");
      await c.query('set local role radcore_app');
      await c.query(RECORD, ['sign_in_failed', userId, 'Firefox on Windows', { reason: 'invalid_credentials' }]);
      await c.query('set local role radcore_read');
      expect(await outcome(c, RECORD, ['sign_in', userId, null, {}])).toBe('42501');
      await c.query('reset role');
      const { rows } = await c.query(`select kind, device, detail, created_by, abs(extract(epoch from occurred_at - now())) < 1 as now
        from radcore.event_log where user_id = $1`, [userId]);
      expect(rows).toEqual([{ kind: 'sign_in_failed', device: 'Firefox on Windows', detail: { reason: 'invalid_credentials' },
        created_by: 'system:public', now: true }]);
    });
  });

  it('refuses an event with no principal (RA005)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      expect(await outcome(c, RECORD, ['sign_in', randomUUID(), null, {}])).toBe('RA005');
    });
  });

  it('refuses an unknown kind, a detail that is not an object or is over 2 KB, and a long device', async () => {
    await inRollback(async (c) => {
      await c.query("set local app.principal = 'user:asha'");
      await c.query('set local role radcore_app');
      const id = randomUUID();
      expect(await outcome(c, RECORD, ['role_changed', id, null, {}])).toBe('23514');
      expect(await outcome(c, RECORD, ['export', id, null, JSON.stringify(['parties'])])).toBe('23514');
      expect(await outcome(c, RECORD, ['export', id, null, { what: 'x'.repeat(2100) }])).toBe('23514');
      expect(await outcome(c, RECORD, ['export', id, 'd'.repeat(81), {}])).toBe('23514');
      expect(await outcome(c, RECORD, ['export', id, 'd'.repeat(80), { what: 'parties', rows: 3 }])).toBe('ok');
    });
  });

  it('keeps an event as written: the app can neither insert one directly nor change or delete one', async () => {
    await inRollback(async (c) => {
      await c.query("set local app.principal = 'user:asha'");
      await c.query('set local role radcore_app');
      const id = randomUUID();
      await c.query(RECORD, ['download', id, null, { fileId: randomUUID() }]);
      expect(await outcome(c, "insert into radcore.event_log (kind) values ('sign_in')")).toBe('42501');
      expect(await outcome(c, 'update radcore.event_log set kind = $1 where user_id = $2', ['sign_in', id])).toBe('42501');
      expect(await outcome(c, 'delete from radcore.event_log where user_id = $1', [id])).toBe('42501');
    });
  });
});

describe.skipIf(!appUrl)('recordSecurityEvent and listSecurityEvents', () => {
  const pool = new pg.Pool({ connectionString: appUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const write = { readOnly: false, isolation: 'read committed' } as const;
  const read = { readOnly: true, isolation: 'read committed' } as const;
  const admin: Principal = { kind: 'user', userId: randomUUID(), permissions: ['audit:read'] };
  const job: Principal = { kind: 'system', name: 'nightly-export', permissions: [] };
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const range = { from: yesterday, to: tomorrow };
  const list = (filter: { kind?: SecurityEvent['kind']; principal?: string }, limit = 50, after?: string) => runInTransaction(db, read, admin, randomUUID(), (ctx) =>
    listSecurityEventsPage(ctx, { filter: { occurred: range, ...filter }, limit, ...(after === undefined ? {} : { after }) }));

  it('records each of the six kinds and reads them back newest first, in the order written (RC-031)', async () => {
    const userId = randomUUID();
    const subject = { userId, device: 'Chrome on Android' };
    await runInTransaction(db, write, { kind: 'system', name: 'public', permissions: [] }, randomUUID(), async (ctx) => {
      await recordSecurityEvent(ctx, { kind: 'sign_in_failed', detail: { reason: 'invalid_credentials' } }, subject);
      await recordSecurityEvent(ctx, { kind: 'sign_in', detail: {} }, subject);
    });
    await runInTransaction(db, write, { kind: 'user', userId, permissions: [] }, randomUUID(), async (ctx) => {
      await recordSecurityEvent(ctx, { kind: 'password_changed', detail: { how: 'change' } }, subject);
      await recordSecurityEvent(ctx, { kind: 'second_factor_changed', detail: { change: 'enrolled' } }, subject);
      await recordSecurityEvent(ctx, { kind: 'export', detail: { what: 'crm.parties', rows: 1200 } }, subject);
      await recordSecurityEvent(ctx, { kind: 'download', detail: { fileId: userId } }, subject);
    });
    const { items, next } = await list({ principal: userId });
    expect(items.map((e) => e.kind)).toEqual(['download', 'export', 'second_factor_changed', 'password_changed', 'sign_in',
      'sign_in_failed']);
    expect(items[1]).toMatchObject({ principal: { kind: 'user', id: userId, displayName: null }, device: 'Chrome on Android',
      detail: { what: 'crm.parties', rows: 1200 } });
    expect(next).toBeNull();
  });

  it('pages through events written in one transaction without skipping or repeating one', async () => {
    const userId = randomUUID();
    await runInTransaction(db, write, { kind: 'user', userId, permissions: [] }, randomUUID(), async (ctx) => {
      for (const rows of [1, 2, 3]) await recordSecurityEvent(ctx, { kind: 'export', detail: { what: 'crm.parties', rows } },
        { userId, device: null });
    });
    const first = await list({ principal: userId }, 2);
    expect(first.items.map((e) => e.detail['rows'])).toEqual([3, 2]);
    const second = await list({ principal: userId }, 2, first.next ?? '');
    expect(second.items.map((e) => e.detail['rows'])).toEqual([1]);
    expect(second.next).toBeNull();
  });

  it('refuses a detail that carries more than its references, such as the typed email (M6-16)', async () => {
    const leak = { kind: 'sign_in_failed', detail: { reason: 'invalid_credentials', email: 'asha@example.com' } };
    await expect(runInTransaction(db, write, admin, randomUUID(), (ctx) =>
      recordSecurityEvent(ctx, leak as unknown as SecurityEvent, { userId: null, device: null }))).rejects.toBeInstanceOf(ZodError);
  });

  it('keeps no event when the work it records rolls back', async () => {
    const userId = randomUUID();
    await expect(runInTransaction(db, write, admin, randomUUID(), async (ctx) => {
      await recordSecurityEvent(ctx, { kind: 'export', detail: { what: 'crm.parties', rows: 9 } }, { userId, device: null });
      throw new Error('the export failed');
    })).rejects.toThrow('the export failed');
    expect((await list({ principal: userId })).items).toEqual([]);
  });

  it('names a system principal that did it, and nobody for a sign-in that matched no account', async () => {
    const requestId = randomUUID();
    await runInTransaction(db, write, job, requestId, (ctx) =>
      recordSecurityEvent(ctx, { kind: 'export', detail: { what: `jobs.r${requestId.slice(0, 8)}`, rows: 0 } },
        { userId: null, device: null }));
    await runInTransaction(db, write, { kind: 'system', name: 'public', permissions: [] }, randomUUID(), (ctx) =>
      recordSecurityEvent(ctx, { kind: 'sign_in_failed', detail: { reason: 'invalid_credentials' } }, { userId: null, device: null }));
    const exports = (await list({ kind: 'export' }, 100)).items;
    expect(exports.find((e) => e.detail['what'] === `jobs.r${requestId.slice(0, 8)}`)?.principal)
      .toEqual({ kind: 'system', id: 'nightly-export', displayName: null });
    const failed = (await list({ kind: 'sign_in_failed' }, 100)).items;
    expect(failed.some((e) => e.principal === null)).toBe(true);
  });

  it('answers range_too_long past 92 days, and filters by kind', async () => {
    await expect(runInTransaction(db, read, admin, randomUUID(), (ctx) => listSecurityEventsPage(ctx,
      { filter: { occurred: { from: '2026-01-01', to: '2026-04-03' } }, limit: 10 }))).rejects.toMatchObject({ code: 'range_too_long' });
    await runInTransaction(db, read, admin, randomUUID(), (ctx) => listSecurityEventsPage(ctx,
      { filter: { occurred: { from: '2026-01-01', to: '2026-04-02' } }, limit: 10 })); // 92 days, both included
    const userId = randomUUID();
    await runInTransaction(db, write, { kind: 'user', userId, permissions: [] }, randomUUID(), async (ctx) => {
      await recordSecurityEvent(ctx, { kind: 'sign_in', detail: {} }, { userId, device: null });
      await recordSecurityEvent(ctx, { kind: 'download', detail: { fileId: userId } }, { userId, device: null });
    });
    expect((await list({ principal: userId, kind: 'sign_in' })).items.map((e) => e.kind)).toEqual(['sign_in']);
  });
});
