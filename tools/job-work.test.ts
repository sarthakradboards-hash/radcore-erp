// RAD-142 (M4-07; ADR-008 §11, §15; ADR-006 §6, F16) on a real PostgreSQL, as the runtime login: job work challans and
// receipts. A challan sends inputs to the job worker's own place; a receipt accounts for them: goods made (at the inputs
// used plus the charge, in a batch the receipt's number names), inputs used and lost (scrapped) and back. Each test
// makes its own items, places and job worker, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, journalEntryById, journalPage, openFinancialYear } from '@radcore/lib-accounts';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, loadConfig, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCategory, addChallan, addItem, addPlace, addReceipt, cancelChallanNow, cancelReceiptNow, getChallanById, listChallansPage,
} from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import stockRoutes from '../apps/api/src/routes/stock.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['stock:read', 'job_work:write', 'items:write', 'locations:write', 'cost:read', 'journal:read', 'parties:write', 'parties:manage'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const none = () => ({ qty: q('0'), batches: [], serials: [] });

describe.skipIf(!url || !superUrl)('job work', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff, settings?: Settings) =>
    runInTransaction(db, WRITE, as, randomUUID(), (ctx) => fn(settings === undefined ? ctx : { ...ctx, settings }));

  /** F16's start: KIT at Stores, `kits` at 1,000.00 in batch B1 (serialised with `serials`); a FRAME (serialised when
   * `serialFrames`); a job worker with their place; and a rejects place. */
  async function setup(o: { kits?: string; serials?: string[]; serialFrames?: boolean } = {}) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const item = (name: string, serialised: boolean) => addItem(ctx, { sku: `${name}-${tag()}`, name, categoryId, hsn: '8714', unit: 'NOS',
        barcode: null, serialised, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const kit = (await item('KIT', o.serials !== undefined)).id;
      const frame = (await item('FRAME', o.serialFrames === true)).id;
      const place = async (kind: 'stores' | 'rejected' | 'job_work', partyId: string | null = null) =>
        (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind, partyId })).id;
      const { id: partyId } = await addParty(ctx, { name: `Job worker ${tag()}`, kinds: ['supplier'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '1 Works Road', addressLine2: null, city: 'Pune', pincode: '411019' });
      const [stores, rejects, jobWorker] = [await place('stores'), await place('rejected'), await place('job_work', partyId)];
      const kits = o.kits ?? '5';
      for (const to of [stores, rejects]) {
        await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId: kit, locationId: to,
          qty: q(to === stores ? kits : '1'), rate: unitPriceString().parse('1000'), batches: [{ batchNo: 'B1', qty: q(to === stores ? kits : '1') }],
          ...(o.serials === undefined ? {} : { units: (to === stores ? o.serials : [`R-${tag()}`]).map((serialNo) => ({ serialNo })) }) }] });
      }
      return { kit, frame, partyId, stores, rejects, jobWorker };
    });
    const batch = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.kit])).rows[0]?.id ?? '';
    return { ...made, batch };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const send = (at: At, qty: string, o: { serials?: string[]; from?: string } = {}) => run((ctx) => addChallan(ctx, { fromId: o.from ?? at.stores,
    partyId: at.partyId, businessDate: DATE, notes: null, lines: [{ itemId: at.kit, qty: q(qty), batches: [{ batchId: at.batch, qty: q(qty) }],
      serials: o.serials ?? [] }] }));
  const challanLine = async (challanId: string) => (await run((ctx) => getChallanById(ctx, { id: challanId }))).lines[0]?.id ?? '';
  const part = (at: At, qty: string, serials: string[] = []) => ({ qty: q(qty), batches: qty === '0' ? [] : [{ batchId: at.batch, qty: q(qty) }], serials });
  const receive = (at: At, challanId: string, line: string, o: { made?: { qty: string; serials?: string[] } | null; used?: string; back?: string;
    lost?: string; usedSerials?: string[]; backSerials?: string[] }) => run((ctx) => addReceipt(ctx, { challanId, locationId: at.stores,
    businessDate: DATE, notes: null, lines: [{ challanLineId: line,
      made: o.made === null || o.made === undefined ? null : { itemId: at.frame, qty: q(o.made.qty), chargeRate: unitPriceString().parse('150'),
        serials: o.made.serials ?? [] },
      used: part(at, o.used ?? '0', o.usedSerials), back: part(at, o.back ?? '0', o.backSerials), lost: o.lost === undefined ? none() : part(at, o.lost) }] }));
  const onHand = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];
  /** A document's entry, summed by account, as "account debit credit", sorted. */
  const entryOf = (sourceId: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'job_work' } });
    const id = page.items.find((e) => e.source.id === sourceId && e.reversesEntryId === null)?.id ?? '';
    const sums = new Map<string, [number, number]>();
    for (const l of (await journalEntryById(ctx, { id })).lines) {
      const [d, c] = sums.get(l.account.name) ?? [0, 0];
      sums.set(l.account.name, [d + Number(l.debit), c + Number(l.credit)]);
    }
    return [...sums].map(([name, [d, c]]) => `${name} ${d.toFixed(2)} ${c.toFixed(2)}`).toSorted();
  });

  // F16: 4 KIT to the job worker; 3 FRAME made from 3, 1 lost, at 150.00 a frame.
  it('posts F16: the kits to the job worker, then 3 frames at 3,450.00 with 1 kit lost, and 450.00 to be billed', async () => {
    const at = await setup();
    const sent = await send(at, '4');
    expect(sent.number).toMatch(/^JWC\//);
    expect(await entryOf(sent.id)).toEqual(['Stock in Hand 4000.00 4000.00']);
    expect([await onHand(at.kit, at.stores), await onHand(at.kit, at.jobWorker)]).toEqual([{ qty: '1', value: '1000.00' }, { qty: '4', value: '4000.00' }]);
    const back = await receive(at, sent.id, await challanLine(sent.id), { made: { qty: '3' }, used: '3', lost: '1' });
    expect(back.number).toMatch(/^JWR\//);
    expect(await entryOf(back.id)).toEqual(['Job Work Charges to be Billed 0.00 450.00', 'Stock Adjustment 1000.00 0.00',
      'Stock in Hand 3450.00 4000.00']);
    expect([await onHand(at.kit, at.stores), await onHand(at.frame, at.stores), await onHand(at.kit, at.jobWorker)])
      .toEqual([{ qty: '1', value: '1000.00' }, { qty: '3', value: '3450.00' }, { qty: '0', value: '0.00' }]);
    // Everything it sent is accounted for, so the challan is closed.
    const c = await run((ctx) => getChallanById(ctx, { id: sent.id }));
    expect([c.open, c.lines[0]?.left, c.lines[0]?.used, c.lines[0]?.lost]).toEqual([false, '0.000', '3.000', '1.000']);
  });

  // RC-130: a serialised output names each serial, and each becomes a unit received in the receipt's batch.
  it('refuses a serialised output without its serials, and with them creates its units in the receipt’s batch', async () => {
    const at = await setup({ serialFrames: true });
    const sent = await send(at, '2');
    const line = await challanLine(sent.id);
    expect(await code(receive(at, sent.id, line, { made: { qty: '2' }, used: '2' }))).toBe('units_mismatch');
    const frames = [`F-${tag()}`, `F-${tag()}`];
    const back = await receive(at, sent.id, line, { made: { qty: '2', serials: frames }, used: '2' });
    const units = (await pool.query<{ serial_no: string; location_id: string; ownership: string; batch_no: string }>(`select u.serial_no, u.location_id,
      u.ownership, b.batch_no from radcore.units u join radcore.batches b on b.id = u.batch_id where u.item_id = $1 order by u.serial_no`, [at.frame])).rows;
    expect(units).toEqual(frames.toSorted().map((serial_no) => ({ serial_no, location_id: at.stores, ownership: 'ours', batch_no: back.number })));
  });

  it('refuses more than a challan line has left, a line not on it, and inputs used or goods made alone', async () => {
    const at = await setup();
    const sent = await send(at, '4');
    const line = await challanLine(sent.id);
    await receive(at, sent.id, line, { back: '2' });
    expect([await code(receive(at, sent.id, line, { made: { qty: '3' }, used: '3' })), await code(receive(at, sent.id, randomUUID(), { back: '1' })),
      await code(receive(at, sent.id, line, { used: '1' })), await code(receive(at, sent.id, line, { made: { qty: '1' } }))])
      .toEqual(['over_challan', 'not_on_challan', 'used_without_made', 'made_without_use']);
    // What's left, 2, can still come back.
    expect(await code(receive(at, sent.id, line, { back: '2' }))).toBe('ok');
  });

  // The architect on RAD-141: a reject is re-inspected or returned to its supplier first, never sent for job work.
  it('sends no challan from rejects, nor from a job worker’s place', async () => {
    const at = await setup();
    expect([await code(send(at, '1', { from: at.rejects })), await code(send(at, '1', { from: at.jobWorker }))]).toEqual(['needs_qc', 'use_job_work']);
  });

  // Section 143: open past stock.job_work_return_days, flagged on the list; one closed or within its days, not.
  it('flags an open challan past its return days, and lists the open ones', async () => {
    const at = await setup();
    const sent = await send(at, '1');
    const list = (days: number, filter: { pastReturnDays?: true; open?: true } = {}) => run(async (ctx) => (await listChallansPage(ctx,
      { limit: 50, filter: { partyId: at.partyId, ...filter } })).items, staff, new Settings([{ key: 'stock.job_work_return_days', value: days }]));
    const [longAgo] = await list(1);
    const [notYet] = await list(3650);
    expect([longAgo?.id, longAgo?.open, longAgo?.pastReturnDays, notYet?.pastReturnDays]).toEqual([sent.id, true, true, false]);
    expect([(await list(1, { pastReturnDays: true })).map((c) => c.id), (await list(3650, { pastReturnDays: true })).length]).toEqual([[sent.id], 0]);
    await receive(at, sent.id, await challanLine(sent.id), { back: '1' });
    expect([(await list(1, { open: true })).length, (await list(1))[0]?.pastReturnDays]).toEqual([0, false]);
  });

  // RC-164: operations sees the documents' quantities and the job worker's charges, but not stock values.
  it('shows operations the charges but not the values, through the API', async () => {
    const at = await setup();
    const sent = await send(at, '4');
    const back = await receive(at, sent.id, await challanLine(sent.id), { made: { qty: '3' }, used: '3', lost: '1' });
    const operations: Principal = { kind: 'user', userId: randomUUID(), permissions: ['stock:read', 'job_work:write'] };
    const config = loadConfig(testSettings(), 'api');
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => operations, routes: stockRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const get = async (path: string) => (await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { origin: config.publicOrigin } })).json() as
        Promise<{ charges: string; lines: { made: { charge: string; chargeRate: string; value: unknown }; lost: { qty: string; value: unknown } }[] }>;
      const r = await get(`/stock/job-work/receipts/${back.id}`);
      const l = r.lines[0];
      expect([r.charges, l?.made.charge, l?.made.chargeRate, l?.lost.qty]).toEqual(['450.00', '450.00', '150.000000', '1.000']);
      expect([l?.made.value, l?.lost.value].every((v) => typeof v === 'object' && v !== null && 'masked' in v)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  // #365's undo for job work's unit events (auditor-2 on #366): a serialised input comes home when its challan is
  // cancelled, and goes back to the job worker when a receipt that brought it home is.
  it('undoes a serialised challan and a receipt of inputs back, and cancels a challan only while no receipt answers it', async () => {
    const serials = [`K-${tag()}`, `K-${tag()}`];
    const at = await setup({ kits: '2', serials });
    const unitAt = async (serial: string) => (await pool.query<{ location_id: string }>('select location_id from radcore.units where item_id = $1 and serial_no = $2',
      [at.kit, serial])).rows[0]?.location_id;
    const cancel = (id: string) => code(run((ctx) => cancelChallanNow(ctx, { id, businessDate: DATE, reason: 'Sent by mistake' })));
    const first = await send(at, '1', { serials: [serials[0] ?? ''] });
    expect(await unitAt(serials[0] ?? '')).toBe(at.jobWorker);
    expect(await cancel(first.id)).toBe('ok');
    expect(await unitAt(serials[0] ?? '')).toBe(at.stores);
    const second = await send(at, '1', { serials: [serials[1] ?? ''] });
    const back = await receive(at, second.id, await challanLine(second.id), { back: '1', backSerials: [serials[1] ?? ''] });
    expect([await unitAt(serials[1] ?? ''), await cancel(second.id)]).toEqual([at.stores, 'challan_answered']);
    expect(await code(run((ctx) => cancelReceiptNow(ctx, { id: back.id, businessDate: DATE, reason: 'Counted wrong' })))).toBe('ok');
    expect([await unitAt(serials[1] ?? ''), (await run((ctx) => getChallanById(ctx, { id: second.id }))).open]).toEqual([at.jobWorker, true]);
    expect(await cancel(second.id)).toBe('ok');
  });
});
