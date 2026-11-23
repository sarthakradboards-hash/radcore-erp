// RAD-148 (M3-33; the architect on RAD-115): a party's credit check stays fast however long its history grows. One
// party with 10,000 documents: 4,000 deliveries (all but 10 invoiced), 4,000 invoices and 2,000 receipts, made in the
// database directly (triggers and foreign keys off for the seed alone) since posting them one by one would take
// minutes. Its credit check reads under 50 ms. A timing test: it runs when RADCORE_TIMING is set, locally, and its
// figures go on the ticket, as a shared CI runner's timings say little. It measures with the monotonic clock
// (process.hrtime), a duration, never the run date (RC-156).
import { randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, partyReceivable } from '@radcore/lib-accounts';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { checkSale } from '@radcore/lib-sales';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { deliveredNotInvoiced } from '../packages/lib-sales/src/services/delivered.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const READ = { readOnly: true, isolation: 'read committed' } as const;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'user', userId: randomUUID(), permissions: ['parties:write', 'parties:read', 'sales:read'] };
// A year no other file posts in.
const FY = '2035-04-01';

describe.skipIf(!url || !superUrl || !process.env['RADCORE_TIMING'])('the credit check with a long history', { timeout: 300_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>, spec: typeof WRITE | typeof READ = WRITE) => runInTransaction(db, spec, AS, randomUUID(), fn);

  it('checks a party with 10,000 documents in under 50 ms', async () => {
    const partyId = await run(async (ctx) => {
      await openFinancialYear(ctx, FY);
      return (await addParty(ctx, { name: `Long history ${randomUUID().slice(0, 6)}`, kinds: ['dealer'], gstin: null, pan: null,
        composition: false, stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null })).id;
    });
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("set local session_replication_role = 'replica'");
      // Deliveries of 1,000.00 and 50.00 GST each, on days through the year, every one invoiced but the last 10.
      await c.query(`insert into radcore.deliveries (id, status, number, order_id, party_id, location_id, business_date, owner)
        select md5($1::text || 'd' || n)::uuid, 'posted', 'T-DN-' || $1::text || '-' || n, gen_random_uuid(), $1::uuid, gen_random_uuid(), $2::date + (n % 360), 'user:x'
        from generate_series(1, 4000) n`, [partyId, FY]);
      await c.query(`insert into radcore.delivery_lines (id, delivery_id, line_no, order_line_id, item_id, qty, picks, taxable, gst, value)
        select md5($1::text || 'dl' || n)::uuid, md5($1::text || 'd' || n)::uuid, 1, gen_random_uuid(), gen_random_uuid(), 1,
          '{"batches":[],"serials":[]}', 1000, 50, 800
        from generate_series(1, 4000) n`, [partyId]);
      await c.query(`insert into radcore.invoices (id, status, number, party_id, business_date, owner, issuer_gstin, place_of_supply,
          taxable, cgst, sgst, total)
        select md5($1::text || 'i' || n)::uuid, 'posted', 'T-SI-' || $1::text || '-' || n, $1::uuid, $2::date + (n % 360), 'user:x', '27AAAAA0000A1Z5', '27', 1000, 25, 25, 1050
        from generate_series(1, 4000) n`, [partyId, FY]);
      await c.query(`insert into radcore.invoice_lines (invoice_id, line_no, delivery_line_id, item_id, qty, rate, hsn, gst_rate, gst_rate_source,
          taxable, cgst, sgst, igst, line_total, cost, delivery_taxable, delivery_gst)
        select md5($1::text || 'i' || n)::uuid, 1, md5($1::text || 'dl' || n)::uuid, gen_random_uuid(), 1, 1000, '87116020', 5, 'Test', 1000, 25, 25, 0, 1050, 800, 1000, 50
        from generate_series(1, 3990) n`, [partyId]);
      // Each invoice's Debtors line, 1,050.00, and 2,000 receipts paying all but the last 20 bills.
      await c.query(`insert into radcore.journal_entries (id, number, kind, business_date, source_table, source_id)
        select md5($1::text || 'e' || n)::uuid, 'T-JV-' || $1::text || '-' || n, case when n <= 4000 then 'invoice' else 'payment_in' end,
          $2::date + (case when n <= 4000 then n else (n - 4000) * 2 end % 360), 'invoices', gen_random_uuid()
        from generate_series(1, 6000) n`, [partyId, FY]);
      await c.query(`insert into radcore.journal_lines (entry_id, line_no, entry_kind, business_date, account_id, account_control_kind,
          party_id, debit, credit)
        select e.id, 1, e.kind, e.business_date, a.id, 'party', $1::uuid, case when e.kind = 'invoice' then 1050 else 0 end,
          case when e.kind = 'invoice' then 0 else 1050 * 3990 / 2000.0 end
        from radcore.journal_entries e, radcore.accounts a where a.system_key = 'debtors' and e.number like 'T-JV-' || $1::text || '-%'`, [partyId]);
      await c.query('commit');
      // Fresh statistics, as autovacuum gives a table this size.
      await c.query('analyze radcore.deliveries, radcore.delivery_lines, radcore.invoices, radcore.invoice_lines, radcore.journal_entries, radcore.journal_lines');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    const on = '2036-03-31';
    const check = () => run(async (ctx) => checkSale(ctx, { stage: 'confirm', partyId, on, adds: '1000', lines: [], pricedBy: 'user:x',
      notInvoiced: await deliveredNotInvoiced(ctx, partyId) }), READ);
    await check();
    const times: number[] = [];
    let last: Awaited<ReturnType<typeof check>> | undefined;
    for (let i = 0; i < 10; i += 1) {
      const start = process.hrtime.bigint();
      last = await check();
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    const timed = async (fn: (ctx: Ctx) => Promise<unknown>) => {
      const t: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const start = process.hrtime.bigint();
        await run(fn, READ);
        t.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      return t.sort((a, b) => a - b)[4]?.toFixed(1);
    };
    const parts = `receivable ${String(await timed((ctx) => partyReceivable(ctx, partyId, on)))} ms, not invoiced ${
      String(await timed((ctx) => deliveredNotInvoiced(ctx, partyId)))} ms, an empty transaction ${String(await timed(async () => null))} ms`;
    times.sort((a, b) => a - b);
    // The 10 open deliveries, and the 10 bills the receipts leave unpaid.
    expect([last?.credit.notInvoiced, last?.credit.outstanding]).toEqual(['10500.00', '10500.00']);
    expect(times[4], `median of ${times.map((t) => t.toFixed(1)).join(', ')} ms (${parts})`).toBeLessThan(50);
  });
});
