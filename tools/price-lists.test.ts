// RAD-98 (M2-13) on a real PostgreSQL as the runtime login: a price changes only after someone else approves it. A
// draft prices nothing; its maker can't approve it (RC-037); approving the exact version sent puts it in force and
// supersedes the one before; an approved version never changes. Discount limits are per role, else the default setting.
import { randomBytes, randomUUID } from 'node:crypto';
import { percentString, unitPriceString } from '@radcore/lib-common';
import { AppError, decideApproval, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addList, askApproval, changeList, discountAllowed, discountLimitFor, getChanges, getList, getVersion, listLimits, listListsPage,
  listRatesPage, priceFor, priceListApproval, putRates, setLimit, setTax, startDraft,
} from '@radcore/lib-sales';
import { addCategory, addItem } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const ownerUrl = process.env['TEST_DATABASE_OWNER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const tag = () => randomBytes(4).toString('hex');
// A business date after any approval a run makes: the version in force now. Tests never read the run's own date.
const LATER = '2099-01-01';

// D-19 widened (Sarthak, 18 Nov: "Yes, approving only"): approving puts prices in force; a draft prices nothing.
it('makes only prices:approve a second-factor key', () => {
  expect(['prices:approve', 'prices:write', 'prices:read'].map((k) => SECOND_FACTOR_KEYS.includes(k))).toEqual([true, false, false]);
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
  const price = (listId: string, itemId: string, on = LATER) => run((ctx) => priceFor(ctx, listId, itemId, on));
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

  it('prices a document by the version in force on its own business date', async () => {
    const { id, draftId: first, requestId, versionHash } = await sent({ [items.a]: '100' });
    await approve(requestId, versionHash);
    const { draftId: second } = await run((ctx) => startDraft(ctx, { id }), as(people.maker));
    await run((ctx) => putRates(ctx, { id: second, rates: [{ itemId: items.a, rate: rate('120') }] }), as(people.maker));
    const again = await run((ctx) => askApproval(ctx, { id: second }), as(people.maker));
    await approve(again.id, again.versionHash);
    // As if the first was approved on 1 Jan 2025 and the second on 1 Jun 2025.
    const client = await ownerPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.principal', 'system:test', true)");
      await client.query("update radcore.price_list_versions set in_force_from = '2025-01-01', superseded_from = '2025-06-01' where id = $1", [first]);
      await client.query("update radcore.price_list_versions set in_force_from = '2025-06-01' where id = $1", [second]);
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await code(price(id, items.a, '2024-12-31'))).toBe('no_price');
    expect([(await price(id, items.a, '2025-01-01')).rate, (await price(id, items.a, '2025-05-31')).rate,
      (await price(id, items.a, '2025-06-01')).rate]).toEqual(['100.000000', '100.000000', '120.000000']);
  });

  it('sets a discount limit only with prices:approve, since raising one lets a role discount without approval', async () => {
    const config = loadConfig(testSettings(), 'api');
    // The same request from two people: only the key differs, so a 403 is the permission's, not the origin guard's.
    const put = async (permissions: string[]) => {
      const principal: Principal = { kind: 'user', userId: people.maker, role: 'admin', permissions };
      const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => principal, routes: salesRoutes });
      const server = await listen(app, 0, '127.0.0.1');
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/sales/discount-limits`, { method: 'PUT',
          body: JSON.stringify({ role: 'operations', maxPercent: '50', reason: 'Test' }),
          headers: { 'content-type': 'application/json', origin: config.publicOrigin, 'idempotency-key': randomUUID() } });
        return [res.status, (await res.json() as { code?: string }).code ?? 'ok'];
      } finally {
        await server.stop();
      }
    };
    try {
      expect(await put(['prices:read', 'prices:write'])).toEqual([403, 'forbidden']);
      expect(await put(['prices:approve'])).toEqual([200, 'ok']);
    } finally {
      await run((ctx) => setLimit(ctx, { role: 'operations', maxPercent: null, reason: 'Test' }));
    }
  });

  it('reads one list, its rates with each item, and what a draft changes against the version in force', async () => {
    const { id, draftId: first, requestId, versionHash } = await sent({ [items.a]: '100', [items.b]: '7' });
    await approve(requestId, versionHash);
    expect(await run((ctx) => getList(ctx, { id }))).toMatchObject({ id, active: true, inForce: { versionId: first }, draftId: null });
    const rates = await run((ctx) => listRatesPage(ctx, { id: first, filter: {}, limit: 10 }));
    expect(rates.items.find((r) => r.itemId === items.a)).toMatchObject({ name: 'Test scooter', unit: 'NOS', rate: '100.000000' });
    const { draftId } = await run((ctx) => startDraft(ctx, { id }), as(people.maker));
    // An unchanged copy changes nothing; then one rate up, one item out, and GST now outside the rate.
    expect((await run((ctx) => getChanges(ctx, { id: draftId }))).changes).toEqual([]);
    await run((ctx) => putRates(ctx, { id: draftId, rates: [{ itemId: items.a, rate: rate('110') }, { itemId: items.b, rate: null }] }), as(people.maker));
    await run((ctx) => setTax(ctx, { id: draftId, taxInclusive: false }), as(people.maker));
    const seen = await run((ctx) => getChanges(ctx, { id: draftId }));
    expect(seen).toMatchObject({ taxInclusive: false, inForce: { versionId: first, taxInclusive: true } });
    expect(seen.changes.map((c) => [c.itemId, c.inForce, c.proposed]).toSorted()).toEqual([
      [items.a, '100.000000', '110.000000'], [items.b, '7.000000', null]].toSorted());
    expect(await code(run((ctx) => getList(ctx, { id: randomUUID() })))).toBe('not_found');
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
