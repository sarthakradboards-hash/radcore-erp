// RAD-120 (RC-152; ADR-007 §7, Rule 46) on a real PostgreSQL, over real HTTP: the sales printouts. A posted
// delivery's challan comes back as a PDF on the 80 mm roll, no-store, with one access row; a draft invoice is refused
// wrong_status; the key and the record scope hold; a draft quote prints. The invoice's template is checked in a
// transaction that's rolled back, since its company profile must stay unset for company.test.ts.
import { randomUUID } from 'node:crypto';
import { recordPayment, setCompanyProfile, systemAccountId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { createPrintPool, createSecrets, loadConfig, type Ctx, type PrintBlock, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addInvoice, addQuote, invoicePrint, postInvoiceNow, receiptPrint } from '@radcore/lib-sales';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import printRoutes from '../apps/api/src/routes/print.ts';
import { postedDelivery } from './delivered-fixture.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'gst:write', 'company:write', 'cost:read', 'payments:write'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const q = (s: string) => quantityString().parse(s);
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Printouts in a test' };
class RolledBack extends Error {}
const config = () => loadConfig(testSettings(), 'api');

describe.skipIf(!url || !superUrl)('sales printouts', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const printing = createPrintPool({ size: 1 });
  afterAll(async () => {
    await printing.close();
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);

  /** GET `path`'s printout on `paper` as `who`: its status, headers and bytes. */
  async function print(who: Principal, path: string, paper: 'a4' | 'thermal80') {
    const app = createApp(config(), { info: () => undefined, error: () => undefined },
      { db, authenticate: async () => who, routes: printRoutes, secrets: createSecrets(config().secrets) });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}?input=${encodeURIComponent(JSON.stringify({ paper }))}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return { status: res.status, type: res.headers.get('content-type'), store: res.headers.get('cache-control'), bytes,
        code: res.headers.get('content-type')?.startsWith('application/json') === true ? (JSON.parse(bytes.toString()) as { code: string }).code : null };
    } finally {
      await server.stop();
    }
  }
  const accessRows = async (table: string, id: string) =>
    (await su.query('select created_by from radcore.access_log where record_table = $1 and record_id = $2', [table, id])).rows;

  it("answers a posted delivery's challan on the 80 mm roll as a PDF, no-store, and logs one look at it", async () => {
    const at = await postedDelivery(run, su, DATE);
    const res = await print(staff, `/sales/deliveries/${at.deliveryId}/pdf`, 'thermal80');
    expect([res.status, res.type, res.store, res.bytes.subarray(0, 5).toString()]).toEqual([200, 'application/pdf', 'no-store', '%PDF-']);
    const width = /\/MediaBox \[0 0 ([\d.]+)/.exec(res.bytes.toString('latin1'))?.[1];
    expect(Math.round(Number(width))).toBe(227);
    expect(await accessRows('deliveries', at.deliveryId)).toEqual([{ created_by: `user:${staff.userId}` }]);
  }, 60_000);

  it('refuses a draft invoice (wrong_status), and holds the key and the record scope', async () => {
    const at = await postedDelivery(run, su, DATE);
    const { id } = await run((ctx) => addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
      lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }] }));
    const draft = await print(staff, `/sales/invoices/${id}/pdf`, 'a4');
    const keyless = await print({ kind: 'user', userId: randomUUID(), permissions: ['sales:write'] }, `/sales/deliveries/${at.deliveryId}/pdf`, 'a4');
    const own = await print({ kind: 'user', userId: randomUUID(), permissions: ['sales:read'], ownScope: ['sales:read'] },
      `/sales/deliveries/${at.deliveryId}/pdf`, 'a4');
    expect([[draft.status, draft.code], [keyless.status, keyless.code], [own.status, own.code]])
      .toEqual([[422, 'wrong_status'], [403, 'forbidden'], [404, 'not_found']]);
    // Nothing refused was logged as a look.
    expect(await accessRows('deliveries', at.deliveryId)).toEqual([]);
  }, 60_000);

  it('prints a draft quote on A4', async () => {
    const at = await postedDelivery(run, su, DATE);
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null,
      lines: [{ itemId: at.itemId, qty: q('2'), rate: unitPriceString().parse('80000'), discountPercent: percentString({ max: '100' }).parse('0') }] }));
    const res = await print(staff, `/sales/quotes/${id}/pdf`, 'a4');
    expect([res.status, res.type, res.bytes.subarray(0, 5).toString()]).toEqual([200, 'application/pdf', '%PDF-']);
  }, 60_000);

  // The architect's ruling: one posted receipt under receipts:print, with no balance on it; a draft and a payment out
  // are not_found; without the key, forbidden.
  it('prints a posted receipt under receipts:print alone, with no balance; a draft or a payment out is not_found', async () => {
    const at = await postedDelivery(run, su, DATE);
    const pay = (kind: 'receipt' | 'payment', amount: string) => run(async (ctx) => recordPayment(ctx, { kind, partyId: at.partyId,
      businessDate: DATE, amount: moneyString().parse(amount), accountId: await systemAccountId(ctx, 'cash'), reference: 'UTR 4431' }));
    const posted = await pay('receipt', '500.00');
    // Past the day's cash limit, so it waits as a draft for an owner (s.269ST).
    const draft = await pay('receipt', '250000.00');
    const out = await pay('payment', '100.00');
    expect([posted.status, draft.status, out.status]).toEqual(['posted', 'pending_approval', 'posted']);
    const counter: Principal = { kind: 'user', userId: randomUUID(), permissions: ['receipts:print'] };
    const res = await print(counter, `/sales/receipts/${posted.id}/pdf`, 'thermal80');
    expect([res.status, res.type, res.bytes.subarray(0, 5).toString()]).toEqual([200, 'application/pdf', '%PDF-']);
    expect(await accessRows('payments', posted.id)).toEqual([{ created_by: `user:${counter.userId}` }]);
    const m = await run((ctx) => receiptPrint.read(ctx, posted.id));
    expect(Object.keys(m).sort()).toEqual(['account', 'amount', 'appliedTo', 'businessDate', 'company', 'number', 'partyName', 'reference', 'tds']);
    expect([m.amount, m.reference, m.account]).toEqual(['500.00', 'UTR 4431', 'Cash']);
    const codes = [(await print(counter, `/sales/receipts/${draft.id}/pdf`, 'a4')).code, (await print(counter, `/sales/receipts/${out.id}/pdf`, 'a4')).code,
      (await print({ ...counter, permissions: ['sales:read'] }, `/sales/receipts/${posted.id}/pdf`, 'a4')).code];
    expect(codes).toEqual(['not_found', 'not_found', 'forbidden']);
  }, 60_000);

  it('lays out every Rule 46 particular on the invoice, as issued, and renders it on both papers', async () => {
    const at = await postedDelivery(run, su, DATE);
    let blocks: { a4: readonly PrintBlock[]; roll: readonly PrintBlock[]; number: string } | undefined;
    await run(async (ctx) => {
      await setCompanyProfile(ctx, COMPANY);
      const { id } = await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }] });
      const { number } = await postInvoiceNow(ctx, { id });
      const m = await invoicePrint.read(ctx, id);
      blocks = { a4: invoicePrint.layout(m, 'a4'), roll: invoicePrint.layout(m, 'thermal80'), number };
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    if (blocks === undefined) throw new Error('the invoice was not laid out');
    const words = JSON.stringify(blocks.a4);
    for (const particular of ['Tax invoice', 'Radboards Pvt Ltd', '27AAPFU0939F1ZV', blocks.number, '15-11-2026', 'Place of supply',
      'Bill to', '12 MG Road, Pune 411001', 'Unregistered', 'Scooter', 'HSN', '₹84,000.00', 'Eighty Four Thousand Rupees Only',
      'Tax payable on reverse charge: No', 'Authorised signatory']) expect(words, particular).toContain(particular);
    for (const [paper, b] of [['a4', blocks.a4], ['thermal80', blocks.roll]] as const) {
      expect(Buffer.from(await printing.render(b, paper, blocks.number)).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }, 60_000);
});
