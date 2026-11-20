// RAD-111 (M3-07; RC-061, RC-131) on a real PostgreSQL, as the app login: the checks every sale stage asks.
// - Credit: the party's Debtors balance, plus what's delivered and not billed, plus this document, against its limit,
//   and its oldest unpaid bill against its credit days.
// - Price: below the item's average cost at the place (the purchase price with nothing on hand), a stock item with no
//   cost at all, and a discount past the person's limit (0% by default), only on lines with a price set.
// And the override spec: what's approved is the document's figures and the issues, so it moves when the issues do.
// Each test makes its own party, items and places.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, postEntry, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, quantityString, unitPriceString, type Money } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { checkSale, overrideApproval, type SaleLine } from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// What the checks need of the people setting up: party terms, item prices, places. checkSale itself needs no key.
const staff: Principal = { kind: 'system', name: 'test', permissions: ['parties:manage', 'cost:read'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const m = (s: string) => moneyString({ signed: true }).parse(s);
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the sale checks must run, not skip');
});

describe.skipIf(!url)('the sale checks', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);

  /** A party owing 30,000.00 on a bill of 1 March 2033, with a limit of 1,00,000.00 and 30 days, or with no terms set. */
  async function party(terms = true): Promise<string> {
    return run(async (ctx) => {
      const { id } = await addParty(ctx, { name: `Dealer ${tag()}`, kinds: ['dealer'], gstin: null, pan: null, composition: false,
        stateCode: '29', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      if (terms) await setCreditTerms(ctx, { id, creditDays: 30, creditLimit: moneyString().parse('100000'), reason: 'Test' });
      await openFinancialYear(ctx, '2033-03-01');
      await postEntry(ctx, { kind: 'opening', businessDate: '2033-03-01', source: { table: SOURCE_TABLE, id: randomUUID() }, lines: [
        { account: { system: 'debtors' }, partyId: id, debit: m('30000') as Money }, { account: { system: 'opening_equity' }, credit: m('30000') as Money }] });
      return id;
    });
  }
  /** Three items: one with 10 on hand at 100.00 each, one with only a purchase price of 50.00, one with no cost at all. */
  async function items() {
    return run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const item = async (purchasePrice: string | null) => (await addItem(ctx, { sku: `S-${tag()}`, name: 'Spare', categoryId, hsn: '8714',
        unit: 'NOS', barcode: null, serialised: false, hasChassis: false, purchasePrice: purchasePrice === null ? null : r(purchasePrice) })).id;
      const stocked = await item(null);
      const place = (await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' })).id;
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: '2033-03-01',
        ins: [{ itemId: stocked, locationId: place, qty: q('10'), rate: r('100'), batches: [{ batchNo: 'B1', qty: q('10') }] }] });
      return { stocked, place, priced: await item('50'), unknown: await item(null) };
    });
  }
  const check = (partyId: string, on: string, adds: string, lines: SaleLine[] = [], notInvoiced = '0') =>
    run((ctx) => checkSale(ctx, { stage: 'invoice', partyId, on, adds, notInvoiced, lines, pricedBy: 'system:test' }));

  it('counts what the party owes, what it was delivered and not billed, and this sale, against its limit (RC-061)', async () => {
    const id = await party();
    expect((await check(id, '2033-03-20', '60000', [], '10000')).credit).toMatchObject({ outstanding: '30000.00', notInvoiced: '10000.00',
      after: '100000.00', overLimit: false, overdue: false });
    const over = await check(id, '2033-03-20', '60000.01', [], '10000');
    expect([over.credit.overLimit, over.issues]).toEqual([true, [{ code: 'over_limit' }]]);
  });

  it('is overdue once the oldest unpaid bill is past its credit days, at whatever stage asks', async () => {
    const id = await party();
    expect((await check(id, '2033-03-31', '0')).credit.overdue).toBe(false);
    const late = await run((ctx) => checkSale(ctx, { stage: 'deliver', partyId: id, on: '2033-04-01', adds: '0', lines: [], pricedBy: 'system:test' }));
    expect([late.stage, late.credit.overdue, late.credit.oldestUnpaid, late.issues]).toEqual(['deliver', true, '2033-03-01', [{ code: 'overdue' }]]);
  });

  it('gives a party with no terms set no credit, and its bills the default days, 0: due the day they are made (Sarthak on RAD-111)', async () => {
    const id = await party(false);
    const today = await check(id, '2033-03-01', '0');
    expect([today.credit.limit, today.credit.overLimit, today.credit.overdue]).toEqual([null, true, false]);
    expect((await check(id, '2033-03-02', '0')).issues).toEqual([{ code: 'over_limit' }, { code: 'overdue' }]);
  });

  it('prices against the average cost at the place, else the purchase price, and a stock item with no cost needs approval (RC-131)', async () => {
    const id = await party();
    const at = await items();
    const line = (itemId: string, rate: string | null, listRate: string | null = null, locationId: string | null = at.place): SaleLine =>
      ({ itemId, locationId, rate, listRate });
    const result = await check(id, '2033-03-20', '0', [line(at.stocked, '99.99'), line(at.stocked, '100'), line(at.priced, '49', null, null),
      line(at.unknown, '10', null, null), line(at.stocked, null)]);
    expect(result.lines.map((l) => [l.cost, l.check])).toEqual([['100.000000', 'below_cost'], ['100.000000', 'ok'],
      ['50.000000', 'below_cost'], [null, 'cost_unknown'], [null, 'not_priced']]);
    expect(result.issues).toEqual([{ code: 'below_cost', line: 0 }, { code: 'below_cost', line: 2 }, { code: 'cost_unknown', line: 3 }]);
  });

  it('judges a discount off the list rate against the person’s limit, 0% by default (RAD-98)', async () => {
    const id = await party();
    const at = await items();
    const result = await check(id, '2033-03-20', '0', [{ itemId: at.stocked, locationId: at.place, rate: '999.99', listRate: '1000' },
      { itemId: at.stocked, locationId: at.place, rate: '1000', listRate: '1000' }]);
    expect(result.lines.map((l) => [l.discount, l.overDiscount])).toEqual([['0.001000', true], ['0.000000', false]]);
    expect(result.issues).toEqual([{ code: 'over_discount', line: 0 }]);
  });

  it('approves an override of the document’s figures and its issues, which move when the issues do', async () => {
    const id = await party();
    let adds = '80000';
    const spec = overrideApproval({ kind: 'test-override', table: 'files',
      read: async (_ctx, documentId) => (documentId === 'none' ? null
        : { figures: { total: adds }, sale: { stage: 'confirm', partyId: id, on: '2033-03-20', adds, lines: [], pricedBy: 'system:test' } }),
      approved: async () => undefined, rejected: async () => undefined });
    const version = (doc: string) => run((ctx) => spec.version(ctx, doc, { forUpdate: false }));
    expect(await version('doc')).toEqual({ figures: { total: '80000' }, issues: [{ code: 'over_limit' }] });
    adds = '1000';
    expect(await version('doc')).toEqual({ figures: { total: '1000' }, issues: [] });
    expect(await version('none')).toBeNull();
  });
});
