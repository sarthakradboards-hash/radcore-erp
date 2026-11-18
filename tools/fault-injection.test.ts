// RAD-97 (M2-09, RC-157; ADR-002 one transaction per save) on a real PostgreSQL 16, as the app login: a save whose
// connection dies halfway leaves nothing behind. The save's own connection is killed just before each of its
// statements in turn, from the first to the COMMIT, as a crashed server or a dropped network would leave it. After each,
// the save left no journal entry and drew no number, nor kept the dead connection from the pool, and the next whole
// save takes the very next number. The journal
// works in 2029-30, a year no other test file posts in, so its counter is this file's alone.
import { randomUUID } from 'node:crypto';
import { openFinancialYear, postEntry } from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import { defineSeries, nextNumber, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: [] };
const DAY = '2029-06-01';
const YEAR = '2029-30';

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the fault-injection tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('a save that fails halfway (RC-157)', { timeout: 60_000 }, () => {
  // `at` > 0 kills the connection just before the save's at-th statement; `sent` counts the statements either way.
  const fault = { at: 0, sent: 0 };
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      fault.sent += 1;
      if (fault.sent !== fault.at) return query(...args);
      // The owner ends the save's backend, then the statement goes out on the dead connection: the database sees the
      // connection drop mid-transaction. The app login itself may not end a backend whose session is the owner's.
      const pid = (client as unknown as { processID: number }).processID;
      return admin.query('select pg_terminate_backend($1)', [pid]).then(() => query(...args));
    };
  });
  // A killed connection's late error reaches the pool after the save has failed; the pool drops that client.
  pool.on('error', () => undefined);
  const db = createDatabase(pool);
  const run = <T>(work: (ctx: Ctx) => Promise<T>) => runInTransaction(db, write, staff, randomUUID(), work);
  const counter = async (series: string, year: string) => (await admin.query<{ last: number }>(
    'select last from radcore.number_counters where series = $1 and financial_year = $2', [series, year])).rows[0]?.last;

  // Runs `save` whole once, which counts its statements, and reads `state`. Then it runs `save` once per statement with
  // the connection killed just before that statement: each must fail as a dropped connection and leave `state` as it was.
  async function killEachStep<S>(save: () => Promise<unknown>, state: () => Promise<S>): Promise<{ steps: number; after: S }> {
    Object.assign(fault, { at: 0, sent: 0 });
    await save();
    const steps = fault.sent;
    const after = await state();
    for (let at = 1; at <= steps; at += 1) {
      Object.assign(fault, { at, sent: 0 });
      const failed = await save().then(() => 'saved', (e: unknown) => {
        const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
        return `${err.cause?.code ?? err.code ?? ''} ${err.cause?.message ?? err.message ?? ''}`;
      });
      fault.at = 0;
      const where = `killed before statement ${String(at)} of ${String(steps)}`;
      expect(failed, where).toMatch(/57P01|Connection terminated|not queryable|ECONNRESET/);
      expect(await state(), where).toEqual(after);
      // Nor does it keep the dead connection: the pool gets it back, even when it died on BEGIN (client.ts).
      await vi.waitFor(() => expect(pool.totalCount - pool.idleCount, where).toBe(0));
    }
    return { steps, after };
  }

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('leaves no journal entry, line or number behind, wherever the connection dies', async () => {
    const m = (x: string) => x as Money;
    const post = () => run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: { table: 'files', id: randomUUID() },
      lines: [{ account: { system: 'cash' }, debit: m('3.00') }, { account: { system: 'opening_equity' }, credit: m('3.00') }] }));
    const books = async () => ({
      entries: (await admin.query("select 1 from radcore.journal_entries where business_date >= '2029-04-01' and business_date < '2030-04-01'")).rowCount,
      lines: (await admin.query("select 1 from radcore.journal_lines where business_date >= '2029-04-01' and business_date < '2030-04-01'")).rowCount,
      last: await counter('accounts.journal', YEAR),
    });
    const { steps, after } = await killEachStep(post, books);
    // The lock, the year, the accounts, the number, the entry and its lines all lie between BEGIN and COMMIT.
    expect(steps).toBeGreaterThanOrEqual(8);
    const next = await post();
    expect(Number(next.number.split('/')[2])).toBe((after.last ?? 0) + 1);
  });

  it('gives the number back when the connection dies after it is drawn, so the series stays gap-free', async () => {
    const series = defineSeries(`platform.t_fault_${randomUUID().slice(0, 8)}`, 'FI');
    const draw = () => run((ctx) => nextNumber(ctx, series, DAY));
    const { after } = await killEachStep(draw, () => counter(series.key, YEAR));
    expect(after).toBe(1);
    expect(await draw()).toBe('FI/29-30/00002');
  });
});
