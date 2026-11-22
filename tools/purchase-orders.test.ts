// RAD-136 (M4-01; ADR-008 §1, §3, §5, §13, §15) on a real PostgreSQL, as the runtime login: purchase orders. A PO is
// drafted for a supplier, then placed: at once within its placer's role limit, else by someone else's approval under
// purchasing:approve, which places it. A placed PO keeps its supplier and date, and isn't raised past what was approved
// or its placer's limit. Each test makes its own supplier, item and role, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear } from '@radcore/lib-accounts';
import { moneyString, percentString, PURCHASE_ORDER_STATUSES, quantityString, STATE_TRANSITIONS, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addOrder, cancelOrder, changeOrder, closeOrder, dropOrder, getOrderById, listOrderLimits, listOrdersPage, orderApproval, placeOrder,
  setOrderLimit,
} from '@radcore/lib-purchasing';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'parties:write', 'parties:manage', 'items:write', 'cost:read', 'gst:write'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
// 2 × 50,000.00 at 5% GST: 1,05,000.00 with tax.
const line = (itemId: string, qty = '2') => ({ itemId, qty: quantityString().parse(qty), rate: unitPriceString().parse('50000') });

describe.skipIf(!url || !superUrl)('purchase orders', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  // A role of the test's own, with a PO limit when `limit` is given, so no built-in role another file reads changes.
  const role = async (limit?: string): Promise<string> => {
    const key = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      if (limit !== undefined) await c.query('insert into radcore.purchase_order_limits (role, max_total) values ($1, $2)', [key, limit]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return key;
  };
  // A person, made now in a transaction of its own, as the approval engine reads their account's age (RAD-38).
  const newUser = async (permissions: string[], roleKey: string): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Test person', $2 from p returning id`,
    [`buying-${randomUUID()}@example.test`, roleKey]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions, role: roleKey };
  };
  const placer = async (limit?: string) => newUser(KEYS, await role(limit));
  const approver = async () => newUser(['purchasing:read', 'purchasing:approve'], await role());

  // A supplier (or, with `kinds`, another party) and an item with a GST rate of its own from the test's day.
  async function setup(kinds: string[] = ['supplier']) {
    return run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: supplierId } = await addParty(ctx, { name: `Supplier ${tag()}`, kinds: kinds as never, gstin: null, pan: null,
        composition: false, stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8507${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `P-${tag()}`, name: 'Battery pack', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('50000') });
      return { supplierId, itemId };
    });
  }
  const draft = (at: { supplierId: string; itemId: string }, as: Principal, qty = '2') => run((ctx) => addOrder(ctx, {
    supplierId: at.supplierId, businessDate: DATE, expectedBy: null, notes: null, lines: [line(at.itemId, qty)] }), as);
  const change = (id: string, at: { supplierId: string; itemId: string }, as: Principal, qty: string, over: { supplierId?: string; businessDate?: string } = {}) =>
    run((ctx) => changeOrder(ctx, { id, supplierId: over.supplierId ?? at.supplierId, businessDate: over.businessDate ?? DATE, expectedBy: null,
      notes: null, lines: [line(at.itemId, qty)] }), as);
  const approve = (request: { approvalId: string | null; versionHash: string | null }, as: Principal) => run((ctx) => decideApproval(ctx,
    orderApproval, request.approvalId ?? '', { decision: 'approve', versionHash: request.versionHash ?? '' }), as);

  it('keeps its statuses and transitions in step with the database', async () => {
    const { rows } = await su.query<{ f: string; t: string }>(
      "select from_status f, to_status t from radcore.state_transitions where document_table = 'purchase_orders' order by 1, 2");
    expect(rows.map((r) => [r.f, r.t])).toEqual([...(STATE_TRANSITIONS['purchase_orders'] ?? [])].map(([f, t]) => [f, t]).sort());
    const { rows: [ck] } = await su.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conname = 'ck_purchase_orders_status'");
    for (const s of PURCHASE_ORDER_STATUSES) expect(ck?.def).toContain(`'${s}'`);
  });

  it('places a PO within its placer’s limit at once, numbered PO, with its tax stored', async () => {
    const at = await setup();
    const maker = await placer('500000');
    const { id } = await draft(at, maker);
    const placed = await run((ctx) => placeOrder(ctx, { id }), maker);
    expect([placed.status, placed.approvalId]).toEqual(['placed', null]);
    expect(placed.number).toMatch(/^PO\/\d{2}-\d{2}\/\d{5}$/);
    const o = await run((ctx) => getOrderById(ctx, { id }), maker);
    expect([o.status, o.total, o.amounts.taxable, o.approvedTotal, o.awaitingApproval]).toEqual(['placed', '105000.00', '100000.00', null, false]);
    expect(o.lines.map((l) => [l.qty, l.received, l.amounts.lineTotal, l.name])).toEqual([['2.000', '0', '105000.00', 'Battery pack']]);
    expect(await code(run((ctx) => placeOrder(ctx, { id }), maker))).toBe('wrong_status');
  });

  it('sends a PO above its placer’s limit for someone else’s approval under purchasing:approve, which places it', async () => {
    const at = await setup();
    const maker = await placer('100000');
    const checker = await approver();
    const { id } = await draft(at, maker);
    const asked = await run((ctx) => placeOrder(ctx, { id }), maker);
    expect([asked.status, asked.number]).toEqual(['pending_approval', null]);
    expect((await run((ctx) => getOrderById(ctx, { id }), maker)).awaitingApproval).toBe(true);
    // Its maker can't approve their own, even holding the key.
    const both = await newUser([...KEYS, 'purchasing:approve'], await role('100000'));
    const { id: own } = await draft(at, both);
    const ownAsk = await run((ctx) => placeOrder(ctx, { id: own }), both);
    expect(await code(approve(ownAsk, both))).toBe('own_request');
    await approve(asked, checker);
    const o = await run((ctx) => getOrderById(ctx, { id }), maker);
    expect([o.status, o.approvedTotal, o.awaitingApproval]).toEqual(['placed', '105000.00', false]);
    expect(o.number).toMatch(/^PO\//);
  });

  it('sends every PO for approval when its placer’s role has no limit (the default 0)', async () => {
    const at = await setup();
    const maker = await placer();
    const { id } = await draft(at, maker, '1');
    expect((await run((ctx) => placeOrder(ctx, { id }), maker)).status).toBe('pending_approval');
  });

  it('refuses raising an approved PO past its approved total, keeping its lines, and saves a lowered one', async () => {
    const at = await setup();
    const maker = await placer('100000');
    const checker = await approver();
    const { id } = await draft(at, maker);
    await approve(await run((ctx) => placeOrder(ctx, { id }), maker), checker);
    expect(await code(change(id, at, maker, '3'))).toBe('over_approved');
    expect((await run((ctx) => getOrderById(ctx, { id }), maker)).lines.map((l) => l.qty)).toEqual(['2.000']);
    await change(id, at, maker, '1');
    const o = await run((ctx) => getOrderById(ctx, { id }), maker);
    expect([o.status, o.total, o.lines.map((l) => l.qty)]).toEqual(['placed', '52500.00', ['1.000']]);
    // Back up to what was approved is within it, though above the placer's own limit.
    await change(id, at, maker, '2');
    expect((await run((ctx) => getOrderById(ctx, { id }), maker)).total).toBe('105000.00');
  });

  it('bounds an approved PO’s raise by the placer’s limit where it’s higher than what was approved (the architect on RAD-136)', async () => {
    const at = await setup();
    const limited = await role('100000');
    const maker = await newUser(KEYS, limited);
    const checker = await approver();
    const { id } = await draft(at, maker);
    await approve(await run((ctx) => placeOrder(ctx, { id }), maker), checker);
    // Approved at 1,05,000.00; the placer's limit is then raised to 2,00,000.00, so 1,57,500.00 saves and 2,10,000.00 doesn't.
    await su.query(`with p as (select set_config('app.principal', 'system:test', true))
      update radcore.purchase_order_limits set max_total = 200000 from p where role = $1`, [limited]);
    await change(id, at, maker, '3');
    expect((await run((ctx) => getOrderById(ctx, { id }), maker)).total).toBe('157500.00');
    expect(await code(change(id, at, maker, '4'))).toBe('over_approved');
  });

  it('refuses raising a PO placed without approval past its placer’s limit', async () => {
    const at = await setup();
    const maker = await placer('200000');
    const { id } = await draft(at, maker);
    await run((ctx) => placeOrder(ctx, { id }), maker);
    await change(id, at, maker, '3');
    expect(await code(change(id, at, maker, '4'))).toBe('over_approved');
    // Judged by the placer's limit, whoever changes it: an editor with a higher one doesn't lift it (the auditor on #340).
    const editor = await placer('1000000');
    expect(await code(change(id, at, editor, '4'))).toBe('over_approved');
  });

  it('keeps a placed PO’s supplier and date (fixed_once_placed), and refuses one we don’t buy from', async () => {
    const at = await setup();
    const other = await setup();
    const customer = await setup(['customer']);
    const maker = await placer('500000');
    expect(await code(draft(customer, maker))).toBe('not_a_supplier');
    const { id } = await draft(at, maker);
    // A draft changes its supplier freely.
    await change(id, at, maker, '2', { supplierId: other.supplierId });
    await change(id, at, maker, '2', { supplierId: at.supplierId });
    await run((ctx) => placeOrder(ctx, { id }), maker);
    expect(await code(change(id, at, maker, '2', { supplierId: other.supplierId }))).toBe('fixed_once_placed');
    expect(await code(change(id, at, maker, '2', { businessDate: '2026-11-14' }))).toBe('fixed_once_placed');
  });

  it('refuses a switched-off item, and places only while the item is still on', async () => {
    const at = await setup();
    const maker = await placer('500000');
    const { id } = await draft(at, maker);
    await su.query(`with p as (select set_config('app.principal', 'system:test', true)) update radcore.items set active = false from p
      where id = $1`, [at.itemId]);
    expect(await code(draft(at, maker))).toBe('item_inactive');
    expect(await code(run((ctx) => placeOrder(ctx, { id }), maker))).toBe('item_inactive');
  });

  it('closes a pending draft’s request as superseded when the draft is deleted', async () => {
    const at = await setup();
    const maker = await placer();
    const checker = await approver();
    const { id } = await draft(at, maker);
    const asked = await run((ctx) => placeOrder(ctx, { id }), maker);
    await run((ctx) => dropOrder(ctx, { id }), maker);
    expect(await code(approve(asked, checker))).toBe('not_pending');
    expect((await su.query<{ status: string }>('select status from radcore.approvals where id = $1', [asked.approvalId])).rows[0]?.status)
      .toBe('superseded');
  });

  it('closes a placed PO short and cancels one, each with its reason; a placed one isn’t deleted', async () => {
    const at = await setup();
    const maker = await placer('500000');
    const { id: closing } = await draft(at, maker);
    const { id: cancelling } = await draft(at, maker);
    expect(await code(run((ctx) => closeOrder(ctx, { id: closing, reason: 'Supplier out of stock' }), maker))).toBe('wrong_status');
    await run((ctx) => placeOrder(ctx, { id: closing }), maker);
    expect(await code(run((ctx) => dropOrder(ctx, { id: closing }), maker))).toBe('wrong_status');
    await run((ctx) => closeOrder(ctx, { id: closing, reason: 'Supplier out of stock' }), maker);
    await run((ctx) => cancelOrder(ctx, { id: cancelling, reason: 'Ordered twice' }), maker);
    const [c, x] = [await run((ctx) => getOrderById(ctx, { id: closing }), maker), await run((ctx) => getOrderById(ctx, { id: cancelling }), maker)];
    expect([[c.status, c.closedReason], [x.status, x.closedReason, x.number]]).toEqual([['closed', 'Supplier out of stock'], ['cancelled', 'Ordered twice', null]]);
    expect(await code(change(closing, at, maker, '1'))).toBe('wrong_status');
  });

  it('lists only a person’s own POs where that’s their scope, newest first', async () => {
    const at = await setup();
    const mine = { ...(await placer('500000')), ownScope: ['purchasing:read', 'purchasing:write'] } as Principal;
    const { id: theirs } = await draft(at, mine);
    const { id: staffs } = await draft(at, staff);
    const ids = async (as: Principal) => (await run((ctx) => listOrdersPage(ctx, { filter: { supplierId: at.supplierId }, limit: 50 }), as))
      .items.map((o) => o.id);
    expect(await ids(mine)).toEqual([theirs]);
    expect(await ids(staff)).toEqual([staffs, theirs]);
    expect(await code(run((ctx) => getOrderById(ctx, { id: staffs }), mine))).toBe('not_found');
  });

  it('sets a role’s limit and clears it, and refuses a role that doesn’t exist', async () => {
    const key = await role();
    const setter: Principal = { kind: 'user', userId: randomUUID(), permissions: ['purchasing:read', 'purchasing:approve'] };
    await run((ctx) => setOrderLimit(ctx, { role: key, maxTotal: moneyString().parse('250000'), reason: 'Test' }), setter);
    const has = async () => (await run((ctx) => listOrderLimits(ctx), setter)).roles.find((r) => r.role === key)?.maxTotal ?? null;
    expect(await has()).toBe('250000.00');
    await run((ctx) => setOrderLimit(ctx, { role: key, maxTotal: null, reason: 'Test' }), setter);
    expect(await has()).toBeNull();
    expect(await code(run((ctx) => setOrderLimit(ctx, { role: 't_nosuchrole', maxTotal: moneyString().parse('1'), reason: 'Test' }), setter)))
      .toBe('unknown_role');
  });
});
