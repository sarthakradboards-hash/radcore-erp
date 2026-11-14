// RAD-30 part 2: the audit trail as the admin screen reads it, on a real PostgreSQL 16 as the app login. Changes are
// written the way the app writes them (a transaction with its principal), read back newest first in the order
// written, with each value on its side (new, old, or both), personal data as stored ("[redacted]"), and who did it
// named. The audit log is append-only, so its rows stay; each test reads only its own record or principal.
import { randomBytes, randomUUID } from 'node:crypto';
import { addDays } from '@radcore/lib-common';
import { type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditedTablesList, listAuditTrailPage } from '../packages/lib-platform/src/audit-trail.ts';

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the audit-trail tests must run, not skip');
});

describe.skipIf(!url)('listAuditTrail and listAuditedTables', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const admin: Principal = { kind: 'user', userId: randomUUID(), permissions: ['audit:read'] };
  const read = { readOnly: true, isolation: 'read committed' } as const;
  // The rows carry the database's time (now()), so the range is the database's India day, a day either side.
  const range = { from: '', to: '' };
  beforeAll(async () => {
    const { rows } = await pool.query<{ day: string }>("select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day");
    const day = rows[0]?.day ?? '';
    Object.assign(range, { from: addDays(day, -1), to: addDays(day, 1) });
  });

  // Statements in one transaction as `principal`, the way the app's request context sets it.
  async function as(principal: string, statements: [string, unknown[]][]) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', $1, true)", [principal]);
      const out = [];
      for (const [text, params] of statements) out.push((await c.query(text, params)).rows);
      await c.query('commit');
      return out;
    } finally {
      c.release();
    }
  }
  type Filter = { tableName?: string; recordId?: string; principal?: string; op?: 'insert' | 'update' | 'delete' };
  const list = (filter: Filter, limit = 50, after?: string) => runInTransaction(db, read, admin, randomUUID(), (ctx) =>
    listAuditTrailPage(ctx, { filter: { occurred: range, ...filter }, limit, ...(after === undefined ? {} : { after }) }));
  const settingKey = () => `ops.audit_${randomBytes(6).toString('hex')}`;

  it('reads a record\'s history newest first, each value on its side, and who did it by name (RC-030)', async () => {
    const [[user]] = await as('system:test', [["insert into radcore.users (email, display_name, role) values ($1, 'Asha Rao', 'sales') returning id",
      [`asha.${randomBytes(4).toString('hex')}@example.com`]]]) as [[{ id: string }]];
    const key = settingKey();
    await as(`user:${user?.id ?? ''}`, [
      ["insert into radcore.settings (key, value) values ($1, '\"A\"')", [key]],
      ["update radcore.settings set value = '\"B\"' where key = $1", [key]],
      ["delete from radcore.settings where key = $1", [key]],
    ]);
    const { items } = await list({ tableName: 'settings', recordId: key });
    expect(items.map((r) => [r.op, r.changed])).toEqual([
      ['delete', { value: { old: 'B' } }],
      ['update', { value: { old: 'A', new: 'B' } }],
      ['insert', { value: { new: 'A' } }],
    ]);
    expect(items[0]?.principal).toEqual({ kind: 'user', id: user?.id, displayName: 'Asha Rao' });
    // The same rows by the person's id, as the screen's person picker sends it, and by op.
    expect((await list({ principal: user?.id ?? '', op: 'update' })).items.map((r) => r.recordId)).toEqual([key]);
  });

  it("arrives with personal data as stored, \"[redacted]\" on both sides, and names a system principal", async () => {
    const [[user]] = await as('system:test', [["insert into radcore.users (email, display_name, role) values ($1, 'Ravi', 'sales') returning id",
      [`ravi.${randomBytes(4).toString('hex')}@example.com`]]]) as [[{ id: string }]];
    await as('system:test', [["update radcore.users set display_name = 'Ravi K' where id = $1", [user?.id]]]);
    const { items } = await list({ tableName: 'users', recordId: user?.id ?? '' });
    expect(items.map((r) => r.changed['display_name'])).toEqual([{ old: '[redacted]', new: '[redacted]' }, { new: '[redacted]' }]);
    expect(JSON.stringify(items)).not.toMatch(/Ravi|ravi\./);
    expect(items[0]?.principal).toEqual({ kind: 'system', id: 'test', displayName: null });
  });

  it("pages one transaction's changes one at a time, in the order written, skipping none", async () => {
    const keys = [settingKey(), settingKey(), settingKey()];
    const principal = `system:paging-${randomBytes(4).toString('hex')}`;
    await as(principal, keys.map((k): [string, unknown[]] => ["insert into radcore.settings (key, value) values ($1, '1')", [k]]));
    const seen: string[] = [];
    let after: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const page = await list({ principal }, 1, after);
      seen.push(...page.items.map((r) => r.recordId));
      if (page.next === null) break;
      after = page.next;
    }
    expect(seen).toEqual(keys.toReversed());
    await as(principal, keys.map((k): [string, unknown[]] => ['delete from radcore.settings where key = $1', [k]]));
  });

  it('answers range_too_long past 92 days, both ends counted', async () => {
    await expect(runInTransaction(db, read, admin, randomUUID(), (ctx) => listAuditTrailPage(ctx,
      { filter: { occurred: { from: '2026-01-01', to: '2026-04-03' } }, limit: 10 }))).rejects.toMatchObject({ code: 'range_too_long' });
  });

  it('lists the audited tables, without the machinery that is only stamped', async () => {
    const { tables } = await runInTransaction(db, read, admin, randomUUID(), (ctx) => listAuditedTablesList(ctx));
    expect(tables).toEqual(expect.arrayContaining(['settings', 'users', 'secrets']));
    expect(tables).not.toContain('saved_once');
    expect(tables).not.toContain('jobs_outbox');
    expect(tables).toEqual(tables.toSorted());
  });
});
