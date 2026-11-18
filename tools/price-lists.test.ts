// RAD-98 (M2-13) on a real PostgreSQL as the runtime login: a price changes only after someone else approves it. A
// draft prices nothing; its maker can't approve it (RC-037); approving the exact version sent puts it in force and
// supersedes the one before; an approved version never changes. Discount limits are per role, else the default setting.
import { randomBytes, randomUUID } from 'node:crypto';
import { percentString, unitPriceString } from '@radcore/lib-common';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addList, askApproval, changeList, discountAllowed, discountLimitFor, getVersion, listLimits, listListsPage, priceFor,
  priceListApproval, putRates, setLimit, setTax, startDraft,
} from '@radcore/lib-sales';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const ownerUrl = process.env['TEST_DATABASE_OWNER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const tag = () => randomBytes(4).toString('hex');

// Whether writing and approving prices needs the second factor is Sarthak's (D-19): one switch sets both, never reading.
it('treats drafting and approving prices alike for the second factor, and never reading them', () => {
  const [w, a, r] = ['prices:write', 'prices:approve', 'prices:read'].map((k) => SECOND_FACTOR_KEYS.includes(k));
  expect([w === a, r]).toEqual([true, false]);
});

it.runIf(process.env['CI'] && !(url && ownerUrl))('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the price list tests must run, not skip');
});

describe.skipIf(!(url && ownerUrl))('price lists with approval', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  const db = createDatabase(pool);
  const people = { maker: '', approver: '' };
  const items = { a: '', b: '' };

  const run = <R>(fn: (ctx: Ctx) => Promise<R>, who: Principal = AS) => runInTransaction(db, write, who, randomUUID(), fn);
  const as = (userId: string, role = 'admin'): Principal => ({ kind: 'user', userId, role, permissions: [] });
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const rate = (r: string) => unitPriceString().parse(r);
  const price = (listId: string, itemId: string) => run((ctx) => priceFor(ctx, listId, itemId));
  /** A list made, filled and sent for approval by the maker: the list, its draft, the request and the version's hash. */
  const sent = async (rates: Record<string, string>, taxInclusive = true) => {
    const { id, draftId } = await run((ctx) => addList(ctx, { name: `Test list ${tag()}`, taxInclusive }), as(people.maker));
    await run((ctx) => putRates(ctx, { id: draftId, rates: Object.entries(rates).map(([itemId, r]) => ({ itemId, rate: rate(r) })) }), as(people.maker));
    const request = await run((ctx) => askApproval(ctx, { id: draftId }), as(people.maker));
    return { id, draftId, requestId: request.id, versionHash: request.versionHash };
  };
  const approve = (requestId: string, versionHash: string, who = people.approver) =>
    run((ctx) => decideApproval(ctx, priceListApproval, requestId, { decision: 'approve', versionHash }), as(who, 'owner'));

  // People made now, before any request, in a transaction of their own; and two items to price.
  beforeAll(async () => {
    for (const k of ['maker', 'approver'] as const) {
      const client = await ownerPool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.principal', 'system:test', true)");
        const { rows } = await client.query<{ id: string }>("insert into radcore.users (email, display_name, role) values ($1, 'Test person', 'admin') returning id",
          [`price-${k}-${randomUUID()}@example.test`]);
        await client.query('commit');
        people[k] = rows[0]?.id ?? '';
      } finally {
        client.release();
      }
    }
    const categoryId = (await run((ctx) => addCategory(ctx, { name: `Test ${tag()}` }))).id;
    const item = async () => (await run((ctx) => addItem(ctx, { sku: `P-${tag()}`, name: 'Test scooter', categoryId, hsn: '87116020',
      unit: 'NOS', barcode: null, serialised: false, hasChassis: false }))).id;
    items.a = await item();
    items.b = await item();
  });
  afterAll(async () => { await Promise.all([pool.end(), ownerPool.end()]); });

  it('prices nothing from a draft, and never lets its maker approve it (RC-037)', async () => {
    const { id, requestId, versionHash } = await sent({ [items.a]: '84999.50' });
    expect(await code(price(id, items.a))).toBe('no_price');
    expect(await code(approve(requestId, versionHash, people.maker))).toBe('own_request');
    expect(await code(price(id, items.a))).toBe('no_price');
  });

  it('puts the approved version in force, with its tax-inclusive flag, and refuses an item it doesn’t price', async () => {
    const { id, draftId, requestId, versionHash } = await sent({ [items.a]: '84999.50' }, true);
    await approve(requestId, versionHash);
    expect(await price(id, items.a)).toEqual({ versionId: draftId, rate: '84999.500000', taxInclusive: true });
    expect(await code(price(id, items.b))).toBe('no_price');
    expect((await run((ctx) => getVersion(ctx, { id: draftId }))).state).toBe('in_force');
  });

  it('keeps the old price until a new draft is approved, then supersedes it', async () => {
    const { id, draftId: first, requestId, versionHash } = await sent({ [items.a]: '100' });
    await approve(requestId, versionHash);
    const { draftId } = await run((ctx) => startDraft(ctx, { id }), as(people.maker));
    expect(draftId).not.toBe(first);
    // The draft starts as a copy of the version in force, and asking again gives the same draft.
    expect((await run((ctx) => startDraft(ctx, { id }), as(people.maker))).draftId).toBe(draftId);
    await run((ctx) => putRates(ctx, { id: draftId, rates: [{ itemId: items.a, rate: rate('120') }, { itemId: items.b, rate: rate('5.375') }] }), as(people.maker));
    await run((ctx) => setTax(ctx, { id: draftId, taxInclusive: false }), as(people.maker));
    expect((await price(id, items.a)).rate).toBe('100.000000');
    const request = await run((ctx) => askApproval(ctx, { id: draftId }), as(people.maker));
    await approve(request.id, request.versionHash);
    expect([await price(id, items.a), await price(id, items.b)]).toEqual([
      { versionId: draftId, rate: '120.000000', taxInclusive: false }, { versionId: draftId, rate: '5.375000', taxInclusive: false }]);
    expect((await run((ctx) => getVersion(ctx, { id: first }))).state).toBe('superseded');
    const listed = await run((ctx) => listListsPage(ctx, { filter: {}, limit: 200 }));
    expect(listed.items.find((l) => l.id === id)).toMatchObject({ inForce: { versionId: draftId, taxInclusive: false }, draftId: null });
  });

  it('never changes an approved version, and approves only the version sent', async () => {
    const { draftId, requestId, versionHash } = await sent({ [items.a]: '10' });
    // Changed after it was sent: that version can't be approved; it must be sent again.
    await run((ctx) => putRates(ctx, { id: draftId, rates: [{ itemId: items.a, rate: rate('9') }] }), as(people.maker));
    expect(await code(approve(requestId, versionHash))).toBe('version_changed');
    const again = await run((ctx) => askApproval(ctx, { id: draftId }), as(people.maker));
    await approve(again.id, again.versionHash);
    expect(await code(run((ctx) => putRates(ctx, { id: draftId, rates: [{ itemId: items.a, rate: rate('1') }] })))).toBe('not_a_draft');
    expect(await code(run((ctx) => setTax(ctx, { id: draftId, taxInclusive: false })))).toBe('not_a_draft');
    expect(await code(run((ctx) => askApproval(ctx, { id: draftId })))).toBe('not_a_draft');
  });

  it('prices nothing from a list switched off, refuses an unknown item and a name taken', async () => {
    const { id, requestId, versionHash } = await sent({ [items.a]: '10' });
    await approve(requestId, versionHash);
    await run((ctx) => changeList(ctx, { id, active: false }));
    expect(await code(price(id, items.a))).toBe('no_price');
    const { draftId: next } = await run((ctx) => startDraft(ctx, { id }));
    expect(await code(run((ctx) => putRates(ctx, { id: next, rates: [{ itemId: randomUUID(), rate: rate('1') }] })))).toBe('unknown_item');
    const name = `Test list ${tag()}`;
    await run((ctx) => addList(ctx, { name, taxInclusive: true }));
    expect(await code(run((ctx) => addList(ctx, { name: `  ${name.toUpperCase()} `, taxInclusive: true })))).toBe('name_taken');
  });

  it('limits a discount by role, else by the default setting, and clears both back', async () => {
    const sales = as(randomUUID(), 'technician');
    const pct = (x: string) => percentString().parse(x);
    try {
      expect(await run((ctx) => discountLimitFor(ctx), sales)).toBe('0');
      expect(await run((ctx) => discountAllowed(ctx, '0.01'), sales)).toBe(false);
      await run((ctx) => setLimit(ctx, { role: null, maxPercent: pct('2'), reason: 'Test' }));
      expect(await run((ctx) => discountAllowed(ctx, '2'), sales)).toBe(true);
      await run((ctx) => setLimit(ctx, { role: 'technician', maxPercent: pct('7.5'), reason: 'Test' }));
      expect([await run((ctx) => discountAllowed(ctx, '7.5'), sales), await run((ctx) => discountAllowed(ctx, '7.500001'), sales)]).toEqual([true, false]);
      expect((await run(listLimits)).roles).toContainEqual({ role: 'technician', maxPercent: '7.500000' });
      expect(await code(run((ctx) => setLimit(ctx, { role: 'no_such_role', maxPercent: pct('1'), reason: 'Test' })))).toBe('unknown_role');
    } finally {
      await run((ctx) => setLimit(ctx, { role: 'technician', maxPercent: null, reason: 'Test' }));
      await run((ctx) => setLimit(ctx, { role: null, maxPercent: null, reason: 'Test' }));
    }
    expect(await run((ctx) => discountLimitFor(ctx), sales)).toBe('0');
  });
});
