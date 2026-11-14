// RAD-87 (M2-04, ADR-006 §3, RC-206, RC-200) on a real PostgreSQL 16, as the app login: document numbers are
// gap-free per series and financial year, one query each, with the prefix read from the request's settings. A save
// that rolls back gives its number back; concurrent saves take turns and never share or skip one; and the database,
// not the app, decides the next number. Each test uses its own series, since the database is shared.
import { randomBytes, randomUUID } from 'node:crypto';
import { defineSeries, nextNumber, SERIES_MAX, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const series = (prefix = 'TS') => defineSeries(`platform.t_${letters()}`, prefix);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the numbering tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('numbering', () => {
  // Counts the statements the app login sends while `counting` is on.
  const sent = { counting: false, n: 0 };
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      if (sent.counting) sent.n += 1;
      return query(...args);
    };
  });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });
  const draw = (s: ReturnType<typeof series>, date: string) =>
    runInTransaction(db, write, staff, randomUUID(), (ctx) => nextNumber(ctx, s, date));
  async function asAdmin(text: string, values: unknown[] = []) {
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query(text, values);
      await c.query('commit');
      return rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  it('numbers a series from 1 in each financial year, with its prefix, at most 16 characters', async () => {
    const s = series('JV');
    expect([await draw(s, '2026-04-01'), await draw(s, '2027-03-31'), await draw(s, '2026-11-14')])
      .toEqual(['JV/26-27/00001', 'JV/26-27/00002', 'JV/26-27/00003']);
    // A new financial year starts again at 1; another series has its own count.
    expect(await draw(s, '2027-04-01')).toBe('JV/27-28/00001');
    expect(await draw(series('INV'), '2026-11-14')).toBe('INV/26-27/00001');
    expect('ABCD/26-27/00001'.length).toBe(16);
  });

  it('takes its prefix from the settings, read once with the request', async () => {
    const s = series('JV');
    await asAdmin("insert into radcore.settings (key, value) values ($1, '\"JRN\"')", [s.prefix.key]);
    expect(await draw(s, '2026-11-14')).toBe('JRN/26-27/00001');
    expect(() => defineSeries('platform.t_bad', 'jv')).toThrow();
    expect(() => defineSeries('platform.t_bad', 'TOOLONG')).toThrow();
    expect(() => defineSeries('Platform.bad', 'JV')).toThrow(/<module>.<name>/);
  });

  it('draws a number in one query (RC-200)', async () => {
    const s = series();
    const counts = await runInTransaction(db, write, staff, randomUUID(), async (ctx) => {
      const each: number[] = [];
      for (let i = 0; i < 3; i++) {
        sent.n = 0;
        sent.counting = true;
        await nextNumber(ctx, s, '2026-11-14');
        sent.counting = false;
        each.push(sent.n);
      }
      return each;
    });
    expect(counts).toEqual([1, 1, 1]);
  });

  it('gives a rolled-back save its number back, so the next save has it (RC-206)', async () => {
    const s = series();
    expect(await draw(s, '2026-11-14')).toBe('TS/26-27/00001');
    await expect(runInTransaction(db, write, staff, randomUUID(), async (ctx) => {
      await nextNumber(ctx, s, '2026-11-14');
      throw new Error('the save failed after its number');
    })).rejects.toThrow('the save failed');
    expect(await draw(s, '2026-11-14')).toBe('TS/26-27/00002');
  });

  it('never gives two concurrent saves the same number, nor skips one', async () => {
    const s = series();
    const numbers = await Promise.all(Array.from({ length: 12 }, () => draw(s, '2026-11-14')));
    expect(numbers.toSorted()).toEqual(Array.from({ length: 12 }, (_, i) => `TS/26-27/${String(i + 1).padStart(5, '0')}`));
  });

  it("lets the database, not the app, set the next number, and keeps every counter", async () => {
    const s = series();
    await draw(s, '2026-11-14');
    // The app login sending its own value still gets the last plus one.
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<{ last: number }>(
        'update radcore.number_counters set last = 500 where series = $1 returning last', [s.key]);
      expect(rows).toEqual([{ last: 2 }]);
      const moved = await c.query("update radcore.number_counters set financial_year = '2030-31' where series = $1", [s.key])
        .catch((e: unknown) => (e as { code?: string }).code);
      expect(moved).toBe('RA001');
    } finally {
      await c.query('rollback');
      c.release();
    }
    const gone = await asAdmin('delete from radcore.number_counters where series = $1', [s.key]).catch((e: unknown) => (e as { code?: string }).code);
    expect(gone).toBe('RA001');
  });

  it('refuses a number past the series maximum, rather than one longer than 16 characters', async () => {
    const s = series();
    await draw(s, '2026-11-14');
    // Only the owner, skipping the triggers, can put a counter at its last number.
    await asAdmin(`set local session_replication_role = replica;
      update radcore.number_counters set last = ${String(SERIES_MAX)} where series = '${s.key}'`);
    await expect(draw(s, '2026-11-14')).rejects.toMatchObject({ code: 'series_full' });
  });
});
