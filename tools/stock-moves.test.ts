// RAD-141 (M4-06; ADR-008 §9, §10, §15; ADR-006 §6, F13, F14; RC-123, RC-124) on a real PostgreSQL, as the runtime
// login: stock transfers, counts and adjustments. Each test makes its own item and places and commits its opening stock,
// then its documents, each in a committed transaction, as the routes run them. Counts and adjustments are approved by
// someone else, whose account is made before the test's requests (approver_too_new).
import { randomBytes, randomUUID } from 'node:crypto';
import { journalEntryById, journalPage, openFinancialYear } from '@radcore/lib-accounts';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, decideApproval, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addAdjustment, addCategory, addCount, addItem, addPlace, addTransfer, adjustmentApprovalSpec, askAdjustmentApproval, askCountApproval,
  cancelTransferNow, countApprovalSpec, getCountById, getTransferById, transferApprovalSpec,
} from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['stock:read', 'stock:move', 'stock:count', 'items:write', 'locations:write', 'cost:read', 'journal:read'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

describe.skipIf(!url)('stock transfers, counts and adjustments', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
  });
  const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff, settings?: Settings) =>
    runInTransaction(db, WRITE, as, randomUUID(), (ctx) => fn(settings === undefined ? ctx : { ...ctx, settings }));
  /** A person who approves, committed before any request they decide. */
  const approver = async (): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Approver', 'owner' from p returning id`, [`stock-moves-${randomUUID()}@example.test`]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions: ['stock:read', 'stock:approve', 'journal:read'], role: 'owner' };
  };
  const decide = (spec: Parameters<typeof decideApproval>[1], who: Principal, asked: { id: string; versionHash: string }) =>
    run((ctx) => decideApproval(ctx, spec, asked.id, { decision: 'approve', versionHash: asked.versionHash }), who);

  /** An item (serialised with `serials`) and places of these kinds, with `stock` of it in the first at `rate`, in batch B1. */
  async function setup(kinds: ('stores' | 'store' | 'demo' | 'rejected' | 'franchisee' | 'job_work')[], o: { stock: string; rate: string; serials?: string[] }) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `M-${tag()}`, name: 'Scooter', categoryId, hsn: '8711', unit: 'NOS', barcode: null,
        serialised: o.serials !== undefined, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const places: string[] = [];
      for (const kind of kinds) places.push((await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id);
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: places[0] ?? '',
        qty: q(o.stock), rate: unitPriceString().parse(o.rate), batches: [{ batchNo: 'B1', qty: q(o.stock) }],
        ...(o.serials === undefined ? {} : { units: o.serials.map((serialNo) => ({ serialNo })) }) }] });
      return { itemId, places };
    });
    // Its batch, read once the setup has committed.
    const [batch] = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId])).rows;
    return { ...made, batchId: batch?.id ?? '' };
  }
  const onHand = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];
  const entryOf = (sourceId: string, kind: 'stock_transfer' | 'stock_adjustment') => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind } });
    const id = page.items.find((e) => e.source.id === sourceId && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
  });
  const line = (itemId: string, qty: string, batchId: string, serials: string[] = []) => ({ itemId, qty: q(qty), batches: [{ batchId, qty: q(qty) }], serials });

  // F13: a scooter to the demo floor at the value it left Stores at, its unit `moved` there in condition `demo`.
  it('posts F13: one scooter from Stores to Demo at 61,250.00, the unit now demo', async () => {
    const serials = ['S-0001', 'S-0002', 'S-0003', 'S-0004'].map((s) => `${s}-${tag()}`);
    const at = await setup(['stores', 'demo'], { stock: '4', rate: '61250', serials });
    const [stores, demo] = at.places as [string, string];
    const t = await run((ctx) => addTransfer(ctx, { fromId: stores, toId: demo, businessDate: DATE, reason: 'To the demo floor',
      lines: [line(at.itemId, '1', at.batchId, [serials[3] ?? ''])] }));
    const unit = (await pool.query<{ location_id: string; condition: string; ownership: string }>(
      'select location_id, condition, ownership from radcore.units where item_id = $1 and serial_no = $2', [at.itemId, serials[3]])).rows[0];
    expect([t.number?.startsWith('ST/'), t.approval]).toEqual([true, null]);
    expect(await entryOf(t.id, 'stock_transfer')).toEqual(['Stock in Hand 61250.00 0.00', 'Stock in Hand 0.00 61250.00']);
    expect([unit, await onHand(at.itemId, stores), await onHand(at.itemId, demo)]).toEqual([{ location_id: demo, condition: 'demo', ownership: 'ours' },
      { qty: '3', value: '183750.00' }, { qty: '1', value: '61250.00' }]);
  });

  // RC-124: rejects can't go back to a sellable place without QC; a job worker's place is job work's; never to itself.
  it('refuses rejects to a sellable place (needs_qc), a job work place (use_job_work) and the same place', async () => {
    const at = await setup(['rejected', 'store', 'job_work', 'stores'], { stock: '2', rate: '100' });
    const [rejected, store, jobWork, stores] = at.places as [string, string, string, string];
    const move = (fromId: string, toId: string) => code(run((ctx) => addTransfer(ctx, { fromId, toId, businessDate: DATE, reason: 'Test',
      lines: [line(at.itemId, '1', at.batchId)] })));
    expect([await move(rejected, store), await move(rejected, jobWork), await move(rejected, rejected), await move(rejected, stores)])
      .toEqual(['needs_qc', 'use_job_work', 'transfer_same_location', 'ok']);
  });

  // RC-124: a transfer is undone by its mirror, and refused once the goods have moved on from where it put them.
  it('undoes a transfer, and refuses to once the goods have moved on (goods_moved_on)', async () => {
    const at = await setup(['stores', 'store', 'demo'], { stock: '2', rate: '100' });
    const [stores, store, demo] = at.places as [string, string, string];
    const send = (fromId: string, toId: string, qty: string) => run((ctx) => addTransfer(ctx, { fromId, toId, businessDate: DATE, reason: 'Test',
      lines: [line(at.itemId, qty, at.batchId)] }));
    const first = await send(stores, store, '1');
    await run((ctx) => cancelTransferNow(ctx, { id: first.id, businessDate: DATE, reason: 'Sent in error' }));
    const back = await onHand(at.itemId, stores);
    const second = await send(stores, store, '2');
    await send(store, demo, '2');
    expect([back, (await run((ctx) => getTransferById(ctx, { id: first.id }))).status,
      await code(run((ctx) => cancelTransferNow(ctx, { id: second.id, businessDate: DATE, reason: 'Too late' })))])
      .toEqual([{ qty: '2', value: '200.00' }, 'cancelled', 'goods_moved_on']);
  });

  // Sarthak's setting: into a franchisee's store, off posts at once; on, it waits for someone else's approval.
  it('waits for approval into a franchisee only while stock.franchisee_transfer_approval is on', async () => {
    const boss = await approver();
    const at = await setup(['stores', 'franchisee'], { stock: '3', rate: '100' });
    const [stores, franchisee] = at.places as [string, string];
    const send = (on: boolean) => run((ctx) => addTransfer(ctx, { fromId: stores, toId: franchisee, businessDate: DATE, reason: 'To the franchisee',
      lines: [line(at.itemId, '1', at.batchId)] }), staff, new Settings([{ key: 'stock.franchisee_transfer_approval', value: on }]));
    const off = await send(false);
    const waiting = await send(true);
    // With the setting on, a transfer to any other place still posts at once (§15).
    const [, , other] = (await setup(['stores', 'franchisee', 'store'], { stock: '1', rate: '100' })).places;
    const plain = await run((ctx) => addTransfer(ctx, { fromId: stores, toId: other ?? '', businessDate: DATE, reason: 'To the floor',
      lines: [line(at.itemId, '1', at.batchId)] }), staff, new Settings([{ key: 'stock.franchisee_transfer_approval', value: true }]));
    const before = await onHand(at.itemId, franchisee);
    const own = await code(decide(transferApprovalSpec, staff, waiting.approval ?? { id: '', versionHash: '' }));
    await decide(transferApprovalSpec, boss, waiting.approval ?? { id: '', versionHash: '' });
    const after = await run((ctx) => getTransferById(ctx, { id: waiting.id }));
    expect([off.number?.startsWith('ST/'), off.approval, waiting.number, before, own, after.status, after.number?.startsWith('ST/'),
      plain.number?.startsWith('ST/'), plain.approval]).toEqual([true, null, null, { qty: '1', value: '100.00' }, 'own_request', 'posted', true, true, null]);
  });

  // F14, RC-123: a count lists the pads twice (two shelves); they're one line; nothing posts until someone else approves.
  it('merges a count listing an item twice, posts F14 only once someone else approves, and counts a later sale once', async () => {
    const boss = await approver();
    const at = await setup(['store'], { stock: '7', rate: '200' });
    const [showroom] = at.places as [string];
    const countedAt = new Date(Date.UTC(2026, 10, 15, 10)).toISOString();
    const { id } = await run((ctx) => addCount(ctx, { locationId: showroom, countedAt, businessDate: DATE, reason: 'Month end',
      lines: [{ itemId: at.itemId, batchId: at.batchId, qty: q('4'), serials: [] }, { itemId: at.itemId, batchId: at.batchId, qty: q('2'), serials: [] }] }));
    const drafted = await run((ctx) => getCountById(ctx, { id }));
    // A sale of 1 after the counting, before the approval: the count's book is as at counted_at, so it's not counted twice.
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE,
      outs: [{ itemId: at.itemId, locationId: showroom, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }] }] }));
    const unposted = await onHand(at.itemId, showroom);
    const asked = await run((ctx) => askCountApproval(ctx, { id }));
    expect(await code(decide(countApprovalSpec, staff, asked))).toBe('own_request');
    await decide(countApprovalSpec, boss, asked);
    expect(drafted.lines.map((l) => [l.found, l.book, l.difference])).toEqual([['6.000', '7.000', '-1.000']]);
    expect(unposted).toEqual({ qty: '6', value: '1200.00' });
    expect(await entryOf(id, 'stock_adjustment')).toEqual(['Stock in Hand 0.00 200.00', 'Stock Adjustment 200.00 0.00']);
    expect(await onHand(at.itemId, showroom)).toEqual({ qty: '5', value: '1000.00' });
  });

  // §10: a serial found here but booked at another place is a transfer, not a gain here and a loss there.
  it('refuses a count naming a serial booked at another place (serial_elsewhere) or one the books don’t hold (serial_unknown)', async () => {
    const serials = [`S-${tag()}`];
    const at = await setup(['stores', 'store'], { stock: '1', rate: '61250', serials });
    const [, store] = at.places as [string, string];
    const count = (serial: string) => code(run((ctx) => addCount(ctx, { locationId: store, countedAt: new Date(Date.UTC(2026, 10, 15)).toISOString(),
      businessDate: DATE, reason: 'Test', lines: [{ itemId: at.itemId, batchId: at.batchId, qty: q('1'), serials: [serial] }] })));
    expect([await count(serials[0] ?? ''), await count(`NOPE-${tag()}`)]).toEqual(['serial_elsewhere', 'serial_unknown']);
  });

  // §10: an adjustment changes nothing until approved; a found unit comes in at the place's average.
  it('posts an adjustment of goods found only once someone else approves it', async () => {
    const boss = await approver();
    const at = await setup(['store'], { stock: '2', rate: '150' });
    const [store] = at.places as [string];
    const { id } = await run((ctx) => addAdjustment(ctx, { locationId: store, businessDate: DATE, reason: 'Found behind the counter',
      lines: [{ itemId: at.itemId, direction: 'in', qty: q('1'), condition: null, batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] }));
    const before = await onHand(at.itemId, store);
    const asked = await run((ctx) => askAdjustmentApproval(ctx, { id }));
    await decide(adjustmentApprovalSpec, boss, asked);
    expect([before, await onHand(at.itemId, store)]).toEqual([{ qty: '2', value: '300.00' }, { qty: '3', value: '450.00' }]);
    expect(await entryOf(id, 'stock_adjustment')).toEqual(['Stock in Hand 150.00 0.00', 'Stock Adjustment 0.00 150.00']);
  });

  // F21 (auditor-2 on #339): the books hold 5 in batch L1, and the count finds 5 with the batch unknown. The unlisted L1 is
  // found 0, so the 5 move from L1 to "batch unknown" at the same value, with no entry and nothing gained.
  it('moves a difference between batches alone at the same value, with no entry (F21)', async () => {
    const boss = await approver();
    const at = await setup(['stores'], { stock: '5', rate: '200' });
    const [stores] = at.places as [string];
    const { id } = await run((ctx) => addCount(ctx, { locationId: stores, countedAt: new Date(Date.UTC(2026, 10, 15, 10)).toISOString(),
      businessDate: DATE, reason: 'Batch labels lost', lines: [{ itemId: at.itemId, batchId: null, qty: q('5'), serials: [] }] }));
    const drafted = await run((ctx) => getCountById(ctx, { id }));
    await decide(countApprovalSpec, boss, await run((ctx) => askCountApproval(ctx, { id })));
    const entries = (await pool.query<{ n: number }>("select count(*)::int as n from radcore.journal_entries where source_id = $1", [id])).rows[0]?.n;
    expect(drafted.lines.map((l) => [l.batchId, l.found, l.book, l.difference])).toEqual([[null, '5.000', '0.000', '5.000'], [at.batchId, '0.000', '5.000', '-5.000']]);
    expect([entries, await onHand(at.itemId, stores)]).toEqual([0, { qty: '5', value: '1000.00' }]);
  });

  // §10 (auditor-2 on #339): a serialised shortage writes off, `scrapped`, a unit of the line's batch that wasn't found.
  it('writes off a serialised unit the count didn’t find, from the line’s batch, scrapped', async () => {
    const boss = await approver();
    const serials = [`S-${tag()}`, `S-${tag()}`];
    const at = await setup(['store'], { stock: '2', rate: '61250', serials });
    const [store] = at.places as [string];
    const { id } = await run((ctx) => addCount(ctx, { locationId: store, countedAt: new Date(Date.UTC(2026, 10, 15, 10)).toISOString(), businessDate: DATE,
      reason: 'Month end', lines: [{ itemId: at.itemId, batchId: at.batchId, qty: q('1'), serials: [serials[0] ?? ''] }] }));
    await decide(countApprovalSpec, boss, await run((ctx) => askCountApproval(ctx, { id })));
    const units = (await pool.query<{ serial_no: string; ownership: string }>('select serial_no, ownership from radcore.units where item_id = $1 order by serial_no',
      [at.itemId])).rows;
    expect(units.toSorted((a, b) => (a.serial_no < b.serial_no ? -1 : 1))).toEqual(
      [{ serial_no: serials[0], ownership: 'ours' }, { serial_no: serials[1], ownership: 'gone' }].toSorted((a, b) => ((a.serial_no ?? '') < (b.serial_no ?? '') ? -1 : 1)));
    expect(await entryOf(id, 'stock_adjustment')).toEqual(['Stock in Hand 0.00 61250.00', 'Stock Adjustment 61250.00 0.00']);
  });
});
