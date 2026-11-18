// RAD-91 (M2-12, RC-115) on a real PostgreSQL as the runtime login: GST rates by HSN and date. The newest rate in force
// wins over an older, longer code; no rate is an error, never 0%; a rate is corrected in place and never deleted. Each
// test uses HSN codes of its own, under chapter 97, which no seeded row uses.
import { randomBytes, randomUUID } from 'node:crypto';
import { percentString } from '@radcore/lib-common';
import { gstRateFor, listRatesPage, putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
/** An 8-digit code of the test's own, under chapter 97. */
const code8 = () => `97${String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0')}`;

// D-19 widened (Sarthak, 15 Nov): GST rates decide what every invoice charges, so gst:write needs the second factor.
it('makes gst:write a second-factor key, and gst:read not', () => {
  expect([SECOND_FACTOR_KEYS.includes('gst:write'), SECOND_FACTOR_KEYS.includes('gst:read')]).toEqual([true, false]);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the GST rate tests must run, not skip');
});

describe.skipIf(!url)('GST rates by date', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const put = (hsn: string, effectiveFrom: string, rate: string, source = 'test notification') =>
    run((ctx) => putGstRate(ctx, { hsn, effectiveFrom, rate: percentString().parse(rate), source, note: null, reason: 'Test' }));
  const rateOn = async (hsn: string, on: string) => (await run((ctx) => gstRateFor(ctx, hsn, on))).rate;

  it('answers no_gst_rate when no row covers the code, never 0%', async () => {
    expect(await code(run((ctx) => gstRateFor(ctx, code8(), '2025-10-01')))).toBe('no_gst_rate');
  });

  it('lets a newer heading rate beat an older tariff-item rate, and a longer code win on the same start (RC-115)', async () => {
    const item = code8();
    await put(item, '2017-07-01', '28');
    await put(item.slice(0, 4), '2025-09-22', '18');
    expect([await rateOn(item, '2025-09-21'), await rateOn(item, '2025-09-22'), await rateOn(item, '2026-01-01')]).toEqual(['28.000000', '18.000000', '18.000000']);
    await put(item.slice(0, 6), '2025-09-22', '5');
    expect(await rateOn(item, '2025-10-01')).toBe('5.000000');
    // Before any row started, nothing covers it.
    expect(await code(run((ctx) => gstRateFor(ctx, item, '2017-06-30')))).toBe('no_gst_rate');
  });

  it('corrects a rate in place for the same code and date, and the app can delete none', async () => {
    const item = code8();
    const first = await put(item, '2025-09-22', '12', 'first reading');
    const again = await put(item, '2025-09-22', '5', 'corrected reading');
    expect(again.id).toBe(first.id);
    expect(await run((ctx) => gstRateFor(ctx, item, '2025-10-01'))).toMatchObject({ rate: '5.000000', source: 'corrected reading' });
    expect(await pool.query('delete from radcore.gst_rates where id = $1', [first.id]).then(() => 'ok', (e: { code?: string }) => e.code)).toBe('42501');
  });

  it('lists rates by code and start, narrowed to codes that start with the filter, a page at a time', async () => {
    const item = code8();
    await put(item.slice(0, 6), '2017-07-01', '12');
    await put(item.slice(0, 6), '2025-09-22', '5');
    await put(item, '2025-09-22', '18');
    const page = (after?: string) => run((ctx) => listRatesPage(ctx, { filter: { hsn: item.slice(0, 6) }, limit: 2, ...(after ? { after } : {}) }));
    const first = await page();
    const second = await page(first.next ?? undefined);
    expect([...first.items, ...second.items].map((r) => `${r.hsn}@${r.effectiveFrom}`)).toEqual([
      `${item.slice(0, 6)}@2017-07-01`, `${item.slice(0, 6)}@2025-09-22`, `${item}@2025-09-22`]);
    expect(second.next).toBeNull();
  });
});
