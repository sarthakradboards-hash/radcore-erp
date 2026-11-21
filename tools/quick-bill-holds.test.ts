// RAD-115 PR 2 (Sarthak's "Hold, then complete"; the architect's ruling) on a real PostgreSQL, as the runtime login: a
// quick bill that needs an approval is held, approved by someone else, and completed as held. Each test's item, place,
// stock, list and named party are committed; the bill runs in one transaction that is rolled back, with the company
// profile set there (company.test.ts needs the row unset), and the approver decides in that same transaction (actingAs).
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, recordPayment, setCompanyProfile, setCreditTerms, systemAccountId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, sightOf, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, principalId, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { completeBillNow, confirmOrderNow, getInvoiceById, holdBillNow, orderOverride } from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { rawOf } from '../packages/db/src/tx.ts';
import { mayUse } from '../packages/lib-platform/src/scope.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['items:write', 'locations:write', 'gst:write', 'cost:read',
  'parties:write', 'parties:manage'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Held quick bills in a test' };
class RolledBack extends Error {}

/** The same transaction, acting as `p`: its key checks, and the principal the audit trail records. Test-only. */
async function actingAs(ctx: Ctx, p: Principal): Promise<Ctx> {
  await rawOf(ctx.tx).execute(sql`select set_config('app.principal', ${principalId(p)}, true)`);
  const can = (permission: string, record?: { owner: string }) => mayUse(p, permission, record);
  const see = (permission: string, record: { owner: string }) => {
    if (!can(permission, record)) throw new AppError('not_found', 'Not found');
  };
  return Object.freeze({ ...ctx, principal: p, can, see, shows: sightOf(p.permissions) });
}

describe.skipIf(!url || !superUrl)('held quick bills', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  // The counter role's own grants; and an approver committed before any request they decide (approver_too_new).
  const counter = async (): Promise<Principal> => {
    const { rows } = await su.query<{ permission: string; scope: string }>("select permission, scope from radcore.role_grants where role = 'counter'");
    return { kind: 'user', userId: randomUUID(), role: 'counter', permissions: rows.map((r) => r.permission),
      ownScope: rows.filter((r) => r.scope === 'own').map((r) => r.permission) };
  };
  const approver = async (): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Approver', 'owner' from p returning id`, [`holds-${randomUUID()}@example.test`]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions: ['sales:override', 'sales:read'], role: 'owner' };
  };

  /** A store holding 10 PADs rated 18% at 200.00 each, a list selling them at 345.00, and a customer allowed `limit`. */
  async function setup(limit: string | null) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('18'), source: 'Notification 1/2017-CT(R)', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `H-${tag()}`, name: 'Pad', categoryId, hsn, unit: 'NOS', barcode: null, serialised: false,
        hasChassis: false, purchasePrice: unitPriceString().parse('200') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Showroom ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q('10'), rate: unitPriceString().parse('200'), batches: [{ batchNo: 'B1', qty: q('10') }] }] });
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '1 Main Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      if (limit !== null) await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m(limit), reason: 'Test' });
      return { itemId, placeId, partyId };
    });
    const listId = await priceListFrom(su, DATE, { [made.itemId]: '345' });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, listId, batchId: batch?.id ?? '' };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** In one rolled-back transaction as a counter person, with the company set and the test's list the default. */
  async function atCounter<R>(at: At, fn: (ctx: Ctx, approve: (h: { approvalId: string; versionHash: string }) => Promise<void>) => Promise<R>) {
    const [clerk, boss] = [await counter(), await approver()];
    let out: R | undefined;
    await run(async (raw) => {
      await setCompanyProfile(raw, COMPANY);
      const ctx = { ...raw, settings: new Settings([{ key: 'sales.default_price_list', value: at.listId }]) };
      const approve = async (h: { approvalId: string; versionHash: string }) => {
        await decideApproval(await actingAs(ctx, boss), orderOverride, h.approvalId, { decision: 'approve', versionHash: h.versionHash });
        await actingAs(ctx, clerk);
      };
      out = await fn(ctx, approve);
      throw new RolledBack();
    }, clerk).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }
  type Pay = Parameters<typeof holdBillNow>[1]['payments'][number];
  const hold = (ctx: Ctx, at: At, qty: string, payments: Pay[], partyId?: string, rate = '345') => holdBillNow(ctx, { ...(partyId === undefined ? {} : { partyId }),
    businessDate: DATE, locationId: at.placeId, notes: null, payments, lines: [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse(rate),
      discountPercent: percentString({ max: '100' }).parse('0'), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: [] }] });
  const complete = (ctx: Ctx, orderId: string, approvalCodes: string[] = []) => completeBillNow(ctx, { orderId, businessDate: DATE, approvalCodes });
  const cash = (amount: string): Pay => ({ method: 'cash', amount: m(amount) });

  // 3 PADs: 1,221.00. 200.00 paid now leaves 1,021.00 owed, over a 500.00 limit: held, approved, then sold as held.
  it('holds a named party’s bill over its limit, and completes it once approved with the planned payments', async () => {
    const at = await setup('500');
    const out = await atCounter(at, async (ctx, approve) => {
      const h = await hold(ctx, at, '3', [cash('200'), { method: 'card', amount: m('100') }], at.partyId);
      const early = await failure(complete(ctx, h.orderId, ['A1B2C3']));
      await approve(h);
      const b = await complete(ctx, h.orderId, ['A1B2C3']);
      const inv = await getInvoiceById(ctx, { id: b.invoice.id });
      return { status: h.status, early, b: [b.total, b.paid, b.left, b.receipts.length], inv: [inv.status, inv.total],
        again: await failure(complete(ctx, h.orderId, ['A1B2C3'])) };
    });
    expect(out).toEqual({ status: 'pending_override', early: 'needs_override', b: ['1221.00', '300.00', '921.00', 2], inv: ['posted', '1221.00'],
      again: 'not_held' });
  });

  it('refuses the approval once the party’s balance has moved, a held order confirmed outside the quick bill, and a card with no code', async () => {
    const at = await setup('200');
    const out = await atCounter(at, async (ctx, approve) => {
      // At 150.00, below its 200.00 cost and its list: 3 come to 531.00, 300.00 planned leaves 231.00 owed, over a 200.00 limit.
      const h = await hold(ctx, at, '3', [cash('200'), { method: 'card', amount: m('100') }], at.partyId, '150');
      await approve(h);
      const outside = await failure(confirmOrderNow(ctx, { id: h.orderId }));
      const noCode = await failure(complete(ctx, h.orderId));
      // The party pays 700.00 more in between: it's under its limit now, so the approved issues aren't the ones it has.
      await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('700'), accountId: await systemAccountId(ctx, 'cash') });
      return [outside, noCode, await failure(complete(ctx, h.orderId, ['A1B2C3']))];
    });
    expect(out).toEqual(['quick_bill_held', 'approval_code_required', 'version_changed']);
  });

  it('refuses a walk-in hold short of the bill, and a hold of a bill that needs no approval', async () => {
    const at = await setup('100000');
    const out = await atCounter(at, async (ctx) => [await failure(hold(ctx, at, '3', [cash('1000')])),
      await failure(hold(ctx, at, '3', [cash('1221')], at.partyId))]);
    expect(out).toEqual(['walk_in_pays_in_full', 'no_override_needed']);
  });
});
