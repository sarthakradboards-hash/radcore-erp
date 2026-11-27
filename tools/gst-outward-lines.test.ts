// RAD-154 PR 1 (M5-04; ADR-010 §2, §3; RC-107) on a real PostgreSQL as the runtime login: what GSTR-1 reads. A rate's
// supply kind (a 0% rate is nil-rated, never a sale at 0%), frozen on the invoice line at posting, and gst_outward_lines,
// every posted invoice and credit-note line with its document's frozen buyer and dates. Each test makes its own item.
import { randomBytes, randomUUID } from 'node:crypto';
import { moneyString, percentString, quantityString } from '@radcore/lib-common';
import { gstr1Of, putGstRate } from '@radcore/lib-gst';
import { setGstRate } from '@radcore/lib-gst/contract';
import { AppError, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCreditNote, addInvoice, postInvoiceNow } from '@radcore/lib-sales';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postedDelivery } from './delivered-fixture.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const KEYS = ['gst:returns', 'sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'credit_notes:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'gst:write', 'cost:read'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const q = (s: string) => quantityString().parse(s);

it('takes a supply kind that agrees with the rate: taxable above 0%, nil, exempt or non-GST at 0%', () => {
  const rate = { hsn: '8711', effectiveFrom: '2026-04-01', rate: '0', source: 'Notification 2/2017-CT(R)', note: null, reason: 'Test' };
  const ok = (v: object) => setGstRate.input.safeParse({ ...rate, ...v }).success;
  expect([ok({}), ok({ supplyKind: 'exempt' }), ok({ supplyKind: 'non_gst' }), ok({ supplyKind: 'taxable' }), ok({ rate: '5', supplyKind: 'nil' }),
    ok({ rate: '5', supplyKind: 'taxable' })]).toEqual([true, true, true, false, false, true]);
});

describe.skipIf(!url || !superUrl)('what GSTR-1 reads', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? (e as { constraint?: string }).constraint ?? String(e)));
  const kindOf = async (hsn: string) => (await su.query<{ k: string }>('select supply_kind k from radcore.gst_rates where hsn = $1', [hsn])).rows[0]?.k;
  const code8 = () => `97${String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0')}`;

  it('stores a 0% rate as nil unless it says exempt, and refuses a taxable row at 0%', async () => {
    const [zero, exempt, five] = [code8(), code8(), code8()];
    const put = (hsn: string, rate: string, supplyKind?: 'exempt') => run((ctx) => putGstRate(ctx, { hsn, effectiveFrom: '2026-04-01',
      rate: percentString().parse(rate), source: 'Test', note: null, reason: 'Test', ...(supplyKind === undefined ? {} : { supplyKind }) }));
    await put(zero, '0');
    await put(exempt, '0', 'exempt');
    await put(five, '5');
    expect([await kindOf(zero), await kindOf(exempt), await kindOf(five)]).toEqual(['nil', 'exempt', 'taxable']);
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      expect(await code(c.query("update radcore.gst_rates set supply_kind = 'taxable' where hsn = $1", [zero]))).toBe('ck_gst_rates_supply_kind');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  const outward = async (invoiceId: string) => (await pool.query<{ t: string; kind: string; uqc: string; taxable: string; igst: string;
    cgst: string; invoice: string | null; late: boolean }>(`select document_table t, supply_kind kind, uqc, taxable::text, igst::text, cgst::text,
      invoice_number invoice, late from radcore.gst_outward_lines where invoice_id = $1 order by document_table desc`, [invoiceId])).rows;

  // The architect on #444: the kind is required once a line has its rate, so a posting that leaves it out is refused, and
  // nothing guesses it from the rate. A draft line filled as posting fills it, all but the kind, then with it.
  it('refuses an invoice line given its rate without its supply kind', async () => {
    const at = await postedDelivery(run, su, DATE);
    const { id } = await run((ctx) => addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
      lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }] }));
    const c = await su.connect();
    const fill = (kind: string | null) => c.query(`update radcore.invoice_lines set hsn = '87160000', gst_rate = 5, gst_rate_source = 'Test',
      taxable = 100, cgst = 2.5, sgst = 2.5, igst = 0, line_total = 105, cost = 0, delivery_taxable = 0, delivery_gst = 0, supply_kind = $2
      where invoice_id = $1`, [id, kind]);
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query('savepoint s');
      const without = await code(fill(null));
      await c.query('rollback to savepoint s');
      expect([without, await code(fill('taxable'))]).toEqual(['ck_invoice_lines_supply_kind', 'ok']);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  // The architect's condition on the paired CHECK: a posted line always has its rate (posted_lines_rated, at commit), so
  // its kind is always required. Raw, as sales-invoices' commit-check test posts one: a header of zeros, its line unrated.
  it('refuses at commit an invoice posted with a line that has no rate, and a credit note has the same guard', async () => {
    const at = await postedDelivery(run, su, DATE);
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows: [inv] } = await c.query<{ id: string }>(`insert into radcore.invoices (party_id, owner, business_date)
        values ($1, 'system:test', '${DATE}') returning id`, [at.partyId]);
      await c.query(`insert into radcore.invoice_lines (invoice_id, line_no, delivery_line_id, item_id, qty, rate) values ($1, 1, $2, $3, 1, 1000)`,
        [inv?.id, at.deliveryLineId, at.itemId]);
      await c.query(`update radcore.invoices set status = 'posted', number = $2, issuer_gstin = '27AAPFU0939F1ZV', place_of_supply = '27'
        where id = $1`, [inv?.id, `T/${randomBytes(3).toString('hex')}`]);
      expect(await code(c.query('set constraints all immediate'))).toBe('invoice_lines_rated');
    } finally {
      await c.query('rollback');
      c.release();
    }
    const { rows } = await su.query<{ t: string }>(`select c.relname t from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where g.tgname = 'posted_lines_rated' order by 1`);
    expect(rows.map((r) => r.t)).toEqual(['credit_notes', 'invoices']);
  });

  // Posted notes, which go through approval, are read in PR 2's builder tests.
  it('freezes a 0% line as nil and a 5% line as taxable, reads both through gst_outward_lines, and not a draft note', async () => {
    const [nil, taxed] = [await postedDelivery(run, su, DATE, undefined, { gst: '0' }), await postedDelivery(run, su, DATE)];
    const invoiced = async (at: typeof nil) => run(async (ctx) => {
      const { id } = await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }] });
      await postInvoiceNow(ctx, { id });
      return id;
    });
    const [nilInvoice, taxedInvoice] = [await invoiced(nil), await invoiced(taxed)];
    const frozen = async (id: string) => (await su.query<{ k: string }>('select supply_kind k from radcore.invoice_lines where invoice_id = $1', [id])).rows[0]?.k;
    expect([await frozen(nilInvoice), await frozen(taxedInvoice)]).toEqual(['nil', 'taxable']);
    expect(await outward(nilInvoice)).toEqual([{ t: 'invoices', kind: 'nil', uqc: 'NOS', taxable: '80000.00', igst: '0.00', cgst: '0.00',
      invoice: expect.stringMatching(/^INV\//) as unknown, late: false }]);
    // A value note of 1,000.00 on the taxed invoice, still a draft: not reported.
    const lineId = (await su.query<{ id: string }>('select id from radcore.invoice_lines where invoice_id = $1', [taxedInvoice])).rows[0]?.id ?? '';
    await run((ctx) => addCreditNote(ctx, { invoiceId: taxedInvoice, kind: 'value', businessDate: DATE, locationId: null, reason: 'Discount agreed',
      refund: null, lines: [{ invoiceLineId: lineId, taxable: moneyString().parse('1000') }] }));
    expect((await outward(taxedInvoice)).map((r) => [r.t, r.kind, r.taxable, r.cgst])).toEqual([['invoices', 'taxable', '80000.00', '2000.00']]);

    // GSTR-1 for the month, from the view: other files' invoices share it, so read this test's own HSN rows (Table 12 at
    // 8 digits, each item's code its own), and the nil invoice in Table 8 and nowhere in Table 7.
    const hsnOf = async (id: string) => (await su.query<{ hsn: string }>('select hsn from radcore.invoice_lines where invoice_id = $1', [id])).rows[0]?.hsn;
    const [nilHsn, taxedHsn] = [await hsnOf(nilInvoice), await hsnOf(taxedInvoice)];
    const g = await run((ctx) => gstr1Of({ ...ctx, settings: new Settings([{ key: 'gst.hsn_digits', value: '8' }]) }, { month: DATE.slice(0, 7) }));
    expect(g.table12.filter((r) => r.hsn === nilHsn || r.hsn === taxedHsn).map((r) => [r.part, r.hsn === nilHsn ? 'nil' : 'taxed', r.qty, r.taxable, r.cgst])
      .toSorted()).toEqual([['b2c', 'nil', '1', '80000.00', '0.00'], ['b2c', 'taxed', '1', '80000.00', '2000.00']]);
    expect(g.table8.some((r) => r.supply === 'intra' && r.buyer === 'unregistered' && r.kind === 'nil')).toBe(true);
    expect(g.table7.some((r) => r.rate === '0.000000')).toBe(false);
  });
});
