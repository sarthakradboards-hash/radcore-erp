// RAD-87 (M2-04, ADR-006 §3, RC-206, RC-200) on a real PostgreSQL 16, as the app login: document numbers are
// gap-free per series and financial year, one query each, with the prefix read from the request's settings. A save
// that rolls back gives its number back; concurrent saves take turns and never share or skip one; and the database,
// not the app, decides the next number. Each test uses its own series, since the database is shared.
import { randomBytes, randomUUID } from 'node:crypto';
import { defineSeries, holdSeries, nextNumber, seriesOrder, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const series = (prefix = 'TS') => defineSeries(`platform.t_${letters()}`, prefix, { label: 'Test' });

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
  const admin = new pg.Pool({ connectionString: superUrl, max: 2 });
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

  it('takes the latest prefix in series_prefixes on or before the year, else the declared one (RAD-132)', async () => {
    const s = series('JV');
    await asAdmin("insert into radcore.series_prefixes (series, from_year, prefix) values ($1, '2026-27', 'JRN'), ($1, '2028-29', 'JNL')", [s.key]);
    expect(await draw(s, '2026-11-14')).toBe('JRN/26-27/00001');
    expect(await draw(s, '2027-04-01')).toBe('JRN/27-28/00001');
    expect(await draw(s, '2025-04-01')).toBe('JV/25-26/00001');
    const t = { label: 'Test' };
    expect(() => defineSeries('platform.t_bad', 'jv', t)).toThrow();
    expect(() => defineSeries('platform.t_bad', 'TOOLONG', t)).toThrow();
    expect(() => defineSeries('Platform.bad', 'JV', t)).toThrow(/<module>.<name>/);
    expect(() => defineSeries('platform.t_bad', 'JV', { label: ' ' })).toThrow(/needs a label/);
  });

  it('keeps a year to the prefix its first number took: a change applies from the next financial year (CA-44)', async () => {
    const s = series('JV');
    expect(await draw(s, '2026-11-14')).toBe('JV/26-27/00001');
    await asAdmin("insert into radcore.series_prefixes (series, from_year, prefix) values ($1, '2026-27', 'JRN')", [s.key]);
    // A history row for a year already drawn doesn't change it either.
    expect(await draw(s, '2027-01-10')).toBe('JV/26-27/00002');
    expect(await draw(s, '2027-04-01')).toBe('JRN/27-28/00001');
  });

  it('takes the digits its series declares: 5 by default, more for a series no rule bounds', async () => {
    const journal = defineSeries(`platform.t_${letters()}`, 'JV', { digits: 7, label: 'Test' });
    expect(await draw(journal, '2026-11-14')).toBe('JV/26-27/0000001');
    expect(journal.max).toBe(9_999_999);
    expect(() => defineSeries('platform.t_bad', 'JV', { digits: 3, label: 'Test' })).toThrow(/4 to 9 digits/);
    expect(() => defineSeries('platform.t_bad', 'JV', { digits: 10, label: 'Test' })).toThrow(/4 to 9 digits/);
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
        "update radcore.number_counters set last = 500 where series = $1 returning last, prefix", [s.key]);
      expect(rows).toEqual([{ last: 2, prefix: 'TS' }]);
      const refused = async (text: string) => {
        await c.query('savepoint s');
        return c.query(text, [s.key]).then(() => 'ok', async (e: unknown) => {
          await c.query('rollback to savepoint s');
          return (e as { code?: string }).code;
        });
      };
      expect(await refused("update radcore.number_counters set financial_year = '2030-31' where series = $1")).toBe('RA001');
      // Once a number is drawn, the year keeps its prefix (RAD-132): a change is refused, never a draw.
      expect(await refused("update radcore.number_counters set prefix = 'XX' where series = $1")).toBe('RA001');
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
      update radcore.number_counters set last = ${String(s.max)} where series = '${s.key}'`);
    await expect(draw(s, '2026-11-14')).rejects.toMatchObject({ code: 'series_full' });
  });

  // ADR-006 §1 step 6 (the architect on RAD-115): the series that post no entry (quote, then order), the journal, then
  // the rest by key, each once. A test that confirms an order and then posts, in one transaction, keeps it.
  it('orders series turns: quote and order, the journal, then the rest by key', () => {
    expect(seriesOrder(['sales.order', 'sales.invoice', 'accounts.receipt', 'accounts.journal', 'sales.delivery', 'sales.invoice', 'sales.quote']))
      .toEqual(['sales.quote', 'sales.order', 'accounts.journal', 'accounts.receipt', 'sales.delivery', 'sales.invoice']);
  });

  /** Another transaction holding `key`'s turn until `fn` has run against it: `fn` gets whether the app's waiting save
   * holds the turn of `held` meanwhile. */
  async function whileHeld(key: string, save: () => Promise<unknown>, held?: string) {
    const blocker = await admin.connect();
    try {
      await blocker.query('begin');
      await blocker.query("select pg_advisory_xact_lock(hashtextextended('numbering.' || $1, 0))", [key]);
      const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
      const saved = save();
      const waiter = async () => (await admin.query<{ pid: number }>('select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid])).rows[0]?.pid;
      await vi.waitFor(async () => expect(await waiter()).toBeDefined(), { timeout: 10_000 });
      // The waiting save's granted advisory locks, as each key's 64-bit hash split into pg_locks' two halves.
      const holds = held === undefined ? null : (await admin.query<{ n: number }>(`select count(*)::int as n from pg_locks,
        (select hashtextextended('numbering.' || $2, 0) as h) k where locktype = 'advisory' and granted and pid = $1
        and classid::bigint = (k.h >> 32) & 4294967295 and objid::bigint = k.h & 4294967295`, [await waiter(), held])).rows[0]?.n === 1;
      await blocker.query('commit');
      await saved;
      return holds;
    } finally {
      blocker.release();
    }
  }

  it('waits at a draw for its series’ turn, held by another save', async () => {
    const s = series();
    expect(await whileHeld(s.key, () => draw(s, '2026-11-14'))).toBeNull();
    expect(await draw(s, '2026-11-14')).toBe('TS/26-27/00002');
  });

  it('takes holdSeries’ turns in key order however they are given, so it waits at the later one holding the earlier', async () => {
    const [a, b] = [series(), series()].toSorted((x, y) => (x.key < y.key ? -1 : 1));
    if (a === undefined || b === undefined) throw new Error('two series');
    const hold = () => runInTransaction(db, write, staff, randomUUID(), async (ctx) => {
      await holdSeries(ctx, [b, a]);
      return nextNumber(ctx, b, '2026-11-14');
    });
    expect(await whileHeld(b.key, hold, a.key)).toBe(true);
  });
});
