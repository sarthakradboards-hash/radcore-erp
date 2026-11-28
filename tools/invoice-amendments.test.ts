// RAD-154 PR 3a (M5-04; ADR-010 §5, §13; CA-11) on PostgreSQL 16: a filed invoice's buyer GSTIN is corrected under
// gst:file, to one of the same state, while its GSTR-1 is filed and until gst.amendment_last_day after its financial
// year; the invoice keeps its frozen buyer, and its read and print show the new GSTIN. In a database of its own: it marks
// GSTR-1 filed, which every other file's invoices would meet.
import { randomUUID } from 'node:crypto';
import { addParty, markFiling, openFinancialYear } from '@radcore/lib-accounts';
import { markGstFiling } from '@radcore/lib-accounts/contract';
import { gstinCheckChar } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { amendInvoiceNow, getInvoiceById, invoicePrint } from '@radcore/lib-sales';
import { amendInvoice, getInvoice } from '@radcore/lib-sales/contract';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDatabase } from './test-database.ts';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
  (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String(e));
const gstin = (state: string, pan: string) => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;
const [FIRST, SAME_STATE, OTHER_STATE] = [gstin('27', 'AAACR5055K'), gstin('27', 'AABCT1332L'), gstin('29', 'AABCT1332L')];

it.runIf(process.env['CI'] && !adminUrl)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_ADMIN_URL is not set: in CI the invoice amendment tests must run, not skip');
});

describe.skipIf(!adminUrl)('amending a filed invoice’s GSTIN', { timeout: 60_000 }, () => {
  const own: { pool?: pg.Pool; su?: pg.Pool; db?: ReturnType<typeof createDatabase>; drop?: () => Promise<void> } = {};
  const made = <T>(x: T | undefined): T => {
    if (x === undefined) throw new Error('The database is made in beforeAll');
    return x;
  };
  const su = () => made(own.su);
  const clerk: Principal = { kind: 'user', userId: randomUUID(), permissions: ['gst:file', 'sales:read', 'parties:write'] };
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(made(own.db), WRITE, clerk, randomUUID(), fn);
  const amend = (id: string, to: string) => run((ctx) => amendInvoiceNow(ctx, amendInvoice.input.parse({ id, gstin: to, reason: 'Wrong GSTIN' })));
  /** An invoice (no lines: only its header matters here) to `buyer`, dated `day`: drafted, then marked posted by hand, as
   * posting freezes it, unless it's to stay a draft. */
  const invoice = async (day: string, buyer: string | null, status: 'posted' | 'draft' = 'posted') => {
    const { id: partyId } = await run((ctx) => addParty(ctx, { name: `Buyer ${randomUUID().slice(0, 8)}`, kinds: ['customer'], gstin: null, pan: null,
      composition: false, stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null }));
    const as = `with p as (select set_config('app.principal', 'system:test', true))`;
    const r = await su().query<{ id: string }>(`${as} insert into radcore.invoices (party_id, business_date, owner) select $1, $2, $3 from p returning id`,
      [partyId, day, `user:${clerk.kind === 'user' ? clerk.userId : ''}`]);
    const id = r.rows[0]?.id ?? '';
    if (status === 'posted') {
      await su().query(`${as} update radcore.invoices set status = 'posted', number = $2, issuer_gstin = $3, issuer_state_code = '27',
        buyer_name = 'Buyer', buyer_gstin = $4, buyer_state_code = '27', place_of_supply = '27' from p where id = $1`,
      [id, `INV/T/${randomUUID().slice(0, 8)}`, gstin('27', 'AAACZ1234K'), buyer]);
    }
    return id;
  };

  beforeAll(async () => {
    const fresh = await freshDatabase(adminUrl ?? '');
    own.pool = new pg.Pool({ connectionString: fresh.appUrl, max: 4 });
    own.su = new pg.Pool({ connectionString: fresh.superUrl, max: 2 });
    for (const p of [own.pool, own.su]) p.on('error', (e: Error & { code?: string }) => { if (e.code !== '57P01') throw e; });
    own.db = createDatabase(own.pool);
    own.drop = fresh.drop;
    for (const d of ['2024-04-01', '2025-04-01']) await run((ctx) => openFinancialYear(ctx, d));
    await su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.settings (key, value) select 'gst.filing_start', '"2024-05"' from p`);
    for (const [month, filedOn] of [['2024-05', '2024-06-11'], ['2024-06', '2024-07-11'], ['2024-07', '2024-08-11']] as const) {
      await run((ctx) => markFiling(ctx, markGstFiling.input.parse({ return: 'gstr1', month, arn: `AA${month.replace('-', '')}0000001`, filedOn })));
    }
    // The run's day, fixed (RC-156): 15 June 2025, inside FY 2024-25's window (to 30 November 2025). Dates only, so pg's timers run.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2025-06-15T06:00:00Z') });
  }, 120_000);
  afterAll(async () => {
    vi.useRealTimers();
    await own.pool?.end();
    await own.su?.end();
    await own.drop?.();
  }, 120_000);

  it('corrects a filed invoice to a GSTIN of the same state, twice, and the read and print show the last; the invoice keeps its own', async () => {
    const id = await invoice('2024-05-10', FIRST);
    expect(await code(amend(id, SAME_STATE))).toBe('ok');
    expect(await code(amend(id, SAME_STATE))).toBe('same_gstin');
    expect(await code(amend(id, FIRST))).toBe('ok');
    const rows = (await su().query<{ old_gstin: string; new_gstin: string; business_date: string; reason: string }>(`select old_gstin, new_gstin,
      business_date::text, reason from radcore.invoice_amendments where invoice_id = $1 order by created_at`, [id])).rows;
    expect(rows).toEqual([{ old_gstin: FIRST, new_gstin: SAME_STATE, business_date: '2025-06-15', reason: 'Wrong GSTIN' },
      { old_gstin: SAME_STATE, new_gstin: FIRST, business_date: '2025-06-15', reason: 'Wrong GSTIN' }]);
    const read = getInvoice.output.parse(await run((ctx) => getInvoiceById(ctx, { id })));
    expect([read.amendedGstin, read.buyer?.gstin]).toEqual([FIRST, FIRST]);
    const printed = await run(async (ctx) => invoicePrint.layout(await invoicePrint.read(ctx, id), 'a4'));
    expect(printed).toContainEqual({ kind: 'pairs', rows: [['Amended: buyer GSTIN', FIRST]] });
  });

  it('refuses another state (amendment_changes_heads), a month not filed, a B2C invoice or a draft, and after the window', async () => {
    expect(await code(amend(await invoice('2024-06-03', FIRST), OTHER_STATE))).toBe('amendment_changes_heads');
    expect(await code(amend(await invoice('2024-08-03', FIRST), SAME_STATE))).toBe('not_filed');
    expect(await code(amend(await invoice('2024-06-04', null), SAME_STATE))).toBe('not_b2b');
    expect(await code(amend(await invoice('2024-07-04', FIRST, 'draft'), SAME_STATE))).toBe('wrong_status');
    // The database holds the state too, behind the service.
    const id = await invoice('2024-07-05', FIRST);
    expect(await code(su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.invoice_amendments (invoice_id, business_date, old_gstin, new_gstin, reason)
      select $1, '2025-06-15', $2, $3, 'x' from p`, [id, FIRST, OTHER_STATE]))).toBe('23514');
    // 1 December 2025 is past FY 2024-25's 30 November; a later last day (the CA's) lets it through.
    vi.setSystemTime(new Date('2025-12-01T06:00:00Z'));
    try {
      expect(await code(amend(id, SAME_STATE))).toBe('amendment_window_closed');
      await su().query(`with p as (select set_config('app.principal', 'system:test', true))
        insert into radcore.settings (key, value) select 'gst.amendment_last_day', '"12-31"' from p`);
      expect(await code(amend(id, SAME_STATE))).toBe('ok');
    } finally {
      vi.setSystemTime(new Date('2025-06-15T06:00:00Z'));
      await su().query(`with p as (select set_config('app.principal', 'system:test', true))
        delete from radcore.settings where key = 'gst.amendment_last_day' and exists (select from p)`);
    }
  });
});
