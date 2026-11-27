// RAD-158 (M5-10; ADR-009 §4, §9) on a real PostgreSQL: TDS sections and rates by date. The migration seeds CA-18's
// sections at the 2025-26 rates, unconfirmed (D-08); a rate row is added for a date, corrected in place, never deleted.
// tds:read is all-only, so the role-scope CHECK refuses it at `own`.
import { randomUUID } from 'node:crypto';
import { putTdsRate, tdsRatesPage, tdsSectionsList } from '@radcore/lib-accounts';
import { setTdsRate } from '@radcore/lib-accounts/contract';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const admin: Principal = { kind: 'user', userId: randomUUID(), permissions: ['tds:read', 'tds:write'] };
const row = (o: Record<string, unknown> = {}) => ({ sectionId: randomUUID(), effectiveFrom: '2026-07-01', rate: '2', rateNoPan: '20', singleLimit: null,
  yearlyLimit: '100000', limitKind: 'whole', source: 'Test', note: null, confirmed: false, reason: 'CA-18', ...o });

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the TDS rate tests must run, not skip');
});

it('declares tds:read all-only and tds:write with the second factor', () => {
  expect(PERMISSIONS.filter((p) => p.key.startsWith('tds:')).map((p) => [p.key, p.allOnly, p.secondFactor]))
    .toEqual([['tds:read', true, undefined], ['tds:write', undefined, true]]);
});

it('refuses a no-PAN rate below the rate, and an excess row with no yearly limit', () => {
  expect(setTdsRate.input.safeParse(row()).success).toBe(true);
  expect(setTdsRate.input.safeParse(row({ rateNoPan: '1' })).success).toBe(false);
  expect(setTdsRate.input.safeParse(row({ limitKind: 'excess', yearlyLimit: null })).success).toBe(false);
});

describe.skipIf(!url || !superUrl)('TDS sections and rates', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, admin, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? (e as { constraint?: string }).constraint ?? String(e)));

  it('seeds CA-18’s sections, each with an unconfirmed 2025-26 row (F29’s contractor at 1%, 30,000.00 and 1,00,000.00)', async () => {
    const { items } = await as(tdsSectionsList);
    expect(items.map((s) => s.code)).toEqual(expect.arrayContaining(['194A', '194C-I', '194C-O', '194H', '194I-B', '194I-M', '194J-P', '194J-T']));
    const contractor = items.find((s) => s.code === '194C-I');
    const rates = await as((ctx) => tdsRatesPage(ctx, { limit: 50, filter: { sectionId: contractor?.id ?? '' } }));
    expect(rates.items[0]).toMatchObject({ effectiveFrom: '2025-04-01', rate: '1.000000', rateNoPan: '20.000000', singleLimit: '30000.00',
      yearlyLimit: '100000.00', limitKind: 'whole', confirmed: false });
  });

  it('adds a section’s rate from a date and corrects that row in place, never a second one', async () => {
    const { items } = await as(tdsSectionsList);
    const sectionId = items.find((s) => s.code === '194H')?.id ?? '';
    const from = `2099-0${String(1 + Math.floor(Math.random() * 9))}-01`;
    const first = await as((ctx) => putTdsRate(ctx, setTdsRate.input.parse(row({ sectionId, effectiveFrom: from }))));
    const again = await as((ctx) => putTdsRate(ctx, setTdsRate.input.parse(row({ sectionId, effectiveFrom: from, rate: '5', confirmed: true }))));
    expect(again.id).toBe(first.id);
    const rows = (await su.query('select rate::text, confirmed from radcore.tds_rates where id = $1', [first.id])).rows;
    expect(rows).toEqual([{ rate: '5.000000', confirmed: true }]);
  });

  it('refuses a rate for no such section, and tds:read at own scope', async () => {
    expect(await code(as((ctx) => putTdsRate(ctx, setTdsRate.input.parse(row()))))).toBe('tds_rates_section_id_tds_sections_id_fk');
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await expect(c.query("insert into radcore.role_grants (role, permission, scope) values ('accounts', 'tds:read', 'own')"))
        .rejects.toMatchObject({ constraint: 'ck_role_grants_scope' });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
