// RAD-149 on a real PostgreSQL, over real HTTP: every GET route the api mounts reads real records without a 5xx. The
// handler checks each answer against its contract, and only that check sees a field the service fills tighter or
// looser than the contract allows (#349's recordedAt, #367's empty batchId), so unit tests can't. A seed posts one of
// each kind of document through the services, awkward shapes included: a receipt posted with batches and rejects, a
// cancelled receipt and transfer, drafts, and requests waiting for approval. Then each GET is called: a list with its
// input (its default where it takes one), and a /:id route with the ids this file seeded, never another file's, so no
// read here adds an access row another test counts. The reader holds every key but those that unmask a person's data
// (pii:read, pay:read, parties:contact, leads:contact): an unmasked read logs a look (RC-040), and the shared database's
// other files count their own. A GET this can't reach is pinned below with its reason, so every new GET is either
// reached or listed (the ratchet). Its known limit: it catches only the shapes the seed holds.
import { randomBytes, randomUUID } from 'node:crypto';
import { addAccount, addExpenseCategory, addParty, openFinancialYear, postManual, recordPayment, recordTransfer, setCreditTerms, systemAccountId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, requestFor, unitPriceString } from '@radcore/lib-common';
import { addAdSpend, addCampaign, captureEnquiry, createEnquiryForm, leadSourcesList } from '@radcore/lib-crm';
import { putGstRate } from '@radcore/lib-gst';
import {
  createClientErrors, createSecrets, decideApproval, loadConfig, Settings, startMastersExport, type Ctx, type Principal, type Route,
} from '@radcore/lib-platform';
import { createAuth, createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { PERMISSIONS } from '../packages/lib-platform/src/permissions.ts';
import {
  addBill, postBillNow, addOrder as addPurchaseOrder, addReceipt as addGoodsReceipt, cancelReceiptNow as cancelGoodsReceipt, getOrderById as getPurchaseOrder, getReceiptById,
  placeOrder,
  postReceipt, addReturn as addSupplierReturn, postReturn as postSupplierReturn,
} from '@radcore/lib-purchasing';
import {
  addBooking, addCreditNote, addDelivery, addDeliveryReturn, addInvoice, addList, addOrder, addQuote, askApproval as askPriceListApproval,
  askCreditNoteApproval, askDeliveryOverride, askInvoiceOverride, askOrderOverride, confirmOrderNow, getDeliveryById, getInvoiceById, getOrderById,
  postDeliveryReturnNow, postInvoiceNow, priceListApproval, putRates,
} from '@radcore/lib-sales';
import {
  addAdjustment, addCategory, addChallan, addCount, addItem, addPlace, addReceipt as addJobWorkReceipt, addTransfer, askAdjustmentApproval,
  askCountApproval, cancelTransferNow, getChallanById,
} from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import { apiRoutes } from '../apps/api/src/routes.ts';
import { postedDelivery } from './delivered-fixture.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const m = (s: string) => moneyString().parse(s);
// The keys that show a person's data unmasked, so a read with them logs a look another file may count (RC-040).
const UNMASKING = new Set(['pii:read', 'pay:read', 'parties:contact', 'leads:contact']);
const KEYS = PERMISSIONS.map((p) => p.key).filter((k) => !UNMASKING.has(k));

/**
 * The GETs the sweep doesn't reach, each with why (the ratchet). A route here that the sweep does reach is fine: the
 * list is the floor, and a new GET must either be reached or be named here.
 */
const NOT_REACHED: Readonly<Record<string, string>> = {
  // shortcut: an approved version's price starts on its approval day, the run date, which no test reads (RC-156); reach it by reading the version's start date from the database.
  'GET /price-lists/:id/price': 'an approved price starts on the run date, which this file never reads (RC-156)',
};

/** What each /:id route is called with: the seed's ids, by route. */
type Ids = Record<string, string[]>;

const cfg = loadConfig(testSettings(), 'api');

/** The api's own list, as main.ts mounts it; createAuth's store connects only when used. */
async function apiList(): Promise<readonly Route[]> {
  const log = { info: () => undefined, error: () => undefined };
  const auth = await createAuth(cfg, log);
  try {
    return apiRoutes(auth, createClientErrors(log), createEnquiryForm({ outbound: { request: () => Promise.reject(new Error('no network in this test')) },
      secret: 'unused' }));
  } finally {
    await auth.store.stop();
  }
}

// Express answers with the first route whose pattern matches, in the order they're mounted, so a `/:id` mounted before a
// fixed path of the same shape takes its requests: the sweep found GET /leads/holders answering as GET /leads/:id
// ("holders" is not a record id, 400). No route may be matched by one mounted before it, whatever its method.
it('mounts no route where an earlier one would answer for it', async () => {
  const routes = (await apiList()).map((x) => ({ method: x.contract.method, path: x.contract.path }));
  const pattern = (path: string) => new RegExp(`^${path.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s)).join('/')}$`);
  const shadowed = routes.flatMap((later, j) => routes.slice(0, j)
    .filter((first) => first.method === later.method && pattern(first.path).test(later.path))
    .map((first) => `${later.method} ${later.path} is answered by ${first.path}`));
  expect(shadowed).toEqual([]);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the read sweep must run, not skip');
});

describe.skipIf(!url || !superUrl)('the read sweep', { timeout: 240_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  /** A role of this file's own, with a PO limit when `limit` is given, and a person holding it, made now. */
  async function person(limit?: string): Promise<Principal> {
    const role = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [role]);
      if (limit !== undefined) await c.query('insert into radcore.purchase_order_limits (role, max_total) values ($1, $2)', [role, limit]);
      // Active, as principalFor reads a person (the roles screen and /me do); its hash is never checked here.
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, role, status, password_hash)
        values ($1, 'Sweep', $2, 'active', 'unused') returning id`, [`sweep-${randomUUID()}@example.test`, role]);
      const userId = rows[0]?.id ?? '';
      // A live session of its own, which /me and the sessions list read.
      const session = await c.query<{ id: string }>(`insert into radcore.sessions (user_id, token_hash, device, idle_expires_at, absolute_expires_at)
        values ($1, $2, 'Test', now() + interval '1 hour', now() + interval '1 hour') returning id`, [userId, randomBytes(32).toString('hex')]);
      await c.query('commit');
      return { kind: 'user', userId, sessionId: session.rows[0]?.id ?? '', permissions: KEYS, role };
    } finally {
      c.release();
    }
  }
  const runAs = (who: Principal, settings?: Settings) => <T>(fn: (ctx: Ctx) => Promise<T>) =>
    runInTransaction(db, WRITE, who, randomUUID(), (ctx) => fn(settings === undefined ? ctx : { ...ctx, settings }));

  /** One of each kind of document, through the services, and the ids each /:id route is called with. A step that fails
   * is recorded, not thrown, so the rest still seed and the sweep still runs; the test then fails on it. */
  async function seed(who: Principal, buyer: Principal, failed: string[]): Promise<Ids> {
    const run = runAs(who);
    const ids: Ids = {};
    const add = (paths: string[], ...found: (string | undefined)[]) => {
      for (const p of paths) ids[p] = [...(ids[p] ?? []), ...found.filter((x): x is string => x !== undefined && x !== '')];
    };
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // The base: parties, an item of each kind, places, and stock on hand.
    const base = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const party = async (name: string, kinds: string[]) => (await addParty(ctx, { name: `${name} ${tag()}`, kinds: kinds as never, gstin: null,
        pan: null, composition: false, stateCode: '27', phone: null, email: null, addressLine1: '1 Test Road', addressLine2: null, city: 'Pune',
        pincode: '411001' })).id;
      const [customer, supplier, jobWorker] = [await party('Customer', ['customer']), await party('Supplier', ['supplier']),
        await party('Job worker', ['supplier'])];
      const { id: categoryId } = await addCategory(ctx, { name: `Sweep ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const item = async (serialised: boolean) => (await addItem(ctx, { sku: `W-${tag()}`, name: serialised ? 'Scooter' : 'Brake pad', categoryId, hsn,
        unit: 'NOS', barcode: null, serialised, hasChassis: false, purchasePrice: r('100') })).id;
      const [plain, serial] = [await item(false), await item(true)];
      const place = async (kind: 'stores' | 'store' | 'rejected' | 'franchisee' | 'job_work', partyId: string | null = null) =>
        (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind, partyId })).id;
      const [stores, store, rejects, franchisee, jobWork] = [await place('stores'), await place('store'), await place('rejected'),
        await place('franchisee'), await place('job_work', jobWorker)];
      const serials = [`S-${tag()}`, `S-${tag()}`, `S-${tag()}`];
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [
        { itemId: plain, locationId: stores, qty: q('40'), rate: r('100'), batches: [{ batchNo: 'B1', qty: q('40') }] },
        { itemId: serial, locationId: stores, qty: q('3'), rate: r('1000'), batches: [{ batchNo: 'S1', qty: q('3') }],
          units: serials.map((serialNo) => ({ serialNo })) },
      ] });
      return { customer, supplier, jobWorker, plain, serial, stores, store, rejects, franchisee, jobWork, serials, hsn };
    });
    const batchOf = async (itemId: string) => (await su.query<{ id: string }>('select id from radcore.batches where item_id = $1 order by batch_no',
      [itemId])).rows[0]?.id ?? '';
    const b1 = await batchOf(base.plain);
    add(['GET /parties/:id', 'GET /parties/:id/statement', 'GET /parties/:id/reminders', 'GET /sales/party-price-lists/:partyId'],
      base.customer, base.supplier);
    add(['GET /items/:id'], base.plain, base.serial);
    // A unit received above: its trail (RAD-144).
    add(['GET /stock/units/:id'], (await su.query<{ id: string }>('select id from radcore.units where item_id = $1 order by serial_key limit 1',
      [base.serial])).rows[0]?.id);
    add(['hsn'], base.hsn);
    add(['stores'], base.stores);

    // Sales: two posted deliveries; an invoice posted on the first, a credit note waiting for approval, a quote, a return
    // of the second, and a receipt with its printout.
    await step('sales', async () => {
      const d1 = await postedDelivery(run, su, DATE);
      const d2 = await postedDelivery(run, su, DATE);
      add(['GET /sales/deliveries/:id', 'GET /sales/deliveries/:id/pdf'], d1.deliveryId, d2.deliveryId);
      add(['GET /parties/:id', 'GET /parties/:id/statement', 'GET /parties/:id/reminders', 'GET /sales/party-price-lists/:partyId'], d1.partyId);
      add(['GET /items/:id'], d1.itemId);
      const sold = await run(async (ctx) => {
        const { id } = await addInvoice(ctx, { partyId: d1.partyId, businessDate: DATE, notes: null, shipTo: null,
          lines: [{ deliveryLineId: d1.deliveryLineId, qty: q('1') }] });
        await postInvoiceNow(ctx, { id });
        return { id, lineId: (await getInvoiceById(ctx, { id })).lines[0]?.id ?? '', orderId: (await getDeliveryById(ctx, { id: d1.deliveryId })).orderId };
      });
      add(['GET /sales/invoices/:id', 'GET /sales/invoices/:id/pdf', 'GET /sales/invoices/:id/links'], sold.id);
      add(['GET /sales/orders/:id'], sold.orderId);
      const note = await run(async (ctx) => {
        const { id } = await addCreditNote(ctx, { invoiceId: sold.id, kind: 'value', businessDate: DATE, locationId: null, reason: 'Discount agreed',
          refund: null, lines: [{ invoiceLineId: sold.lineId, taxable: m('100') }] });
        return { id, asked: await askCreditNoteApproval(ctx, { id }) };
      });
      add(['GET /sales/credit-notes/:id'], note.id);
      add(['GET /approvals/credit-note/:id'], note.asked.id);
      const { id: quote } = await run((ctx) => addQuote(ctx, { partyId: d1.partyId, businessDate: DATE, validUntil: null, notes: null,
        lines: [{ itemId: d1.itemId, qty: q('1'), rate: r('80000'), discountPercent: percentString({ max: '100' }).parse('0') }] }));
      add(['GET /sales/quotes/:id', 'GET /sales/quotes/:id/pdf'], quote);
      const back = await run(async (ctx) => {
        const d = await getDeliveryById(ctx, { id: d2.deliveryId });
        const batchId = await batchOf(d2.itemId);
        const { id } = await addDeliveryReturn(ctx, { deliveryId: d2.deliveryId, locationId: d.locationId, businessDate: DATE, notes: null,
          lines: [{ deliveryLineId: d2.deliveryLineId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [] }] });
        await postDeliveryReturnNow(ctx, { id });
        return { id, orderId: d.orderId };
      });
      add(['GET /sales/delivery-returns/:id'], back.id);
      add(['GET /sales/orders/:id'], back.orderId);
      const paid = await run(async (ctx) => recordPayment(ctx, { kind: 'receipt', partyId: d1.partyId, businessDate: DATE, amount: m('500'),
        accountId: await systemAccountId(ctx, 'cash') }));
      add(['GET /payments/:id', 'GET /sales/receipts/:id/pdf'], paid.id);
    });

    // The books: a manual journal.
    await step('journal', async () => {
      const posted = await run(async (ctx) => postManual(ctx, { businessDate: DATE, reason: 'Bank charges',
        lines: [{ accountId: await systemAccountId(ctx, 'round_off'), debit: m('10') }, { accountId: await systemAccountId(ctx, 'bank'), credit: m('10') }] }));
      add(['GET /journal/:id'], posted.id);
      // An expense category, blocked, on an ordinary expense account (RAD-152), and one allowed.
      await run(async (ctx) => {
        // An expense head added under a group (POST /accounts), so the chart reads one.
        const head = await addAccount(ctx, { name: `Sweep head ${randomUUID()}`, parentId: await systemAccountId(ctx, 'round_off'), code: 'SWEEP-1' });
        const accountIds = [await systemAccountId(ctx, 'round_off'), head.id];
        await addExpenseCategory(ctx, { name: `Sweep blocked ${randomUUID()}`, credit: 'blocked', blockedClause: '(b)(i)', accountIds });
        await addExpenseCategory(ctx, { name: `Sweep allowed ${randomUUID()}`, credit: 'allowed', blockedClause: null, accountIds });
      });
    });

    // Stock: a transfer posted, one cancelled, one into a franchisee waiting for approval; a count and an adjustment
    // waiting for approval.
    await step('stock', async () => {
      const move = (fromId: string, toId: string, settings?: Settings) => runAs(who, settings)((ctx) => addTransfer(ctx, { fromId, toId,
        businessDate: DATE, reason: 'Sweep', lines: [{ itemId: base.plain, qty: q('2'), batches: [{ batchId: b1, qty: q('2') }], serials: [] }] }));
      const posted = await move(base.stores, base.store);
      const undone = await move(base.stores, base.store);
      await run((ctx) => cancelTransferNow(ctx, { id: undone.id, businessDate: DATE, reason: 'Sent in error' }));
      const waiting = await move(base.stores, base.franchisee, new Settings([{ key: 'stock.franchisee_transfer_approval', value: true }]));
      add(['GET /stock/transfers/:id'], posted.id, undone.id, waiting.id);
      add(['GET /approvals/stock-transfer/:id'], waiting.approval?.id);
      const counted = await run(async (ctx) => {
        const { id } = await addCount(ctx, { locationId: base.store, countedAt: '2026-11-15T12:00:00.000Z', businessDate: DATE, reason: 'Month end',
          lines: [{ itemId: base.plain, batchId: b1, qty: q('3'), serials: [] }] });
        return { id, asked: await askCountApproval(ctx, { id }) };
      });
      add(['GET /stock/counts/:id'], counted.id);
      add(['GET /approvals/stock-count/:id'], counted.asked.id);
      const adjusted = await run(async (ctx) => {
        const { id } = await addAdjustment(ctx, { locationId: base.stores, businessDate: DATE, reason: 'Damaged', lines: [{ itemId: base.plain,
          direction: 'out', qty: q('1'), condition: null, batches: [{ batchId: b1, qty: q('1') }], serials: [] }] });
        return { id, asked: await askAdjustmentApproval(ctx, { id }) };
      });
      add(['GET /stock/adjustments/:id'], adjusted.id);
      add(['GET /approvals/stock-adjustment/:id'], adjusted.asked.id);
    });

    // Buying: a PO placed and one waiting for approval; receipts posted (with batches and a reject), cancelled and draft.
    await step('purchasing', async () => {
      const order = (as: Principal) => runAs(as)(async (ctx) => {
        const { id } = await addPurchaseOrder(ctx, { supplierId: base.supplier, businessDate: DATE, expectedBy: null, notes: null,
          lines: [{ itemId: base.plain, qty: q('10'), rate: r('100') }] });
        return { id, placed: await placeOrder(ctx, { id }) };
      });
      const placed = await order(who);
      const waiting = await order(buyer);
      add(['GET /purchasing/orders/:id', 'GET /purchasing/orders/:id/pdf'], placed.id, waiting.id);
      add(['GET /approvals/purchase-order/:id'], waiting.placed.approvalId ?? undefined);
      const lineId = (await run((ctx) => getPurchaseOrder(ctx, { id: placed.id }))).lines[0]?.id ?? '';
      const arriveOn = (received: string) => run((ctx) => addGoodsReceipt(ctx, { orderId: placed.id, businessDate: DATE, locationId: base.stores,
        rejectsLocationId: base.rejects, supplierRef: 'DC-1', notes: null, lines: [{ orderLineId: lineId, received: q(received) }] }));
      const inspect = async (id: string, batches: { batchNo: string | null; accepted: string; rejected: string }[], reason: string | null) => {
        const line = (await run((ctx) => getReceiptById(ctx, { id }))).lines[0]?.id ?? '';
        await run((ctx) => postReceipt(ctx, { id, lines: [{ lineId: line, batches: batches.map((b) => ({ batchNo: b.batchNo, accepted: q(b.accepted),
          rejected: q(b.rejected) })), serials: [], rejectReason: reason }] }));
      };
      const posted = await arriveOn('3');
      await inspect(posted.id, [{ batchNo: 'L1', accepted: '2', rejected: '0' }, { batchNo: 'L2', accepted: '0', rejected: '1' }], 'Torn bag');
      const undone = await arriveOn('1');
      await inspect(undone.id, [{ batchNo: null, accepted: '1', rejected: '0' }], null);
      await run((ctx) => cancelGoodsReceipt(ctx, { id: undone.id, businessDate: DATE, reason: 'Entered in error' }));
      const draft = await arriveOn('1');
      add(['GET /purchasing/receipts/:id'], posted.id, undone.id, draft.id);
      // A draft bill on the PO line (a bill names its receipt line from RAD-138's posting PR).
      const bill = await run((ctx) => addBill(ctx, { supplierId: base.supplier, businessDate: DATE, supplierInvoiceNumber: `INV/${tag()}`,
        supplierInvoiceDate: DATE, supplierGstin: null, statedTotal: m('210'), fileId: null, notes: null,
        lines: [{ kind: 'goods', poLineId: lineId, receiptLineId: null, qty: q('2'), rate: r('100') }] }));
      // A bill 3% over the PO rate on the accepted goods, past the 2% tolerance, waits for bills:approve. Posting needs the
      // supplier's file, so one is recorded as uploaded and ready.
      const fileId = randomUUID();
      await su.query(`with p as (select set_config('app.principal', 'system:test', true)) insert into radcore.files
        (id, kind, store_key, filename, content_type, size, status) select $1, 'purchase_bill', $2, 'bill.pdf', 'application/pdf', 2048, 'ready'
        from p`, [fileId, `purchase_bill/${fileId}`]);
      const acceptedLine = (await run((ctx) => getReceiptById(ctx, { id: posted.id }))).lines[0]?.id ?? null;
      const over = await run(async (ctx) => {
        const { id } = await addBill(ctx, { supplierId: base.supplier, businessDate: DATE, supplierInvoiceNumber: `INV/${tag()}`,
          supplierInvoiceDate: DATE, supplierGstin: null, statedTotal: m('108.15'), fileId, notes: null,
          lines: [{ kind: 'goods', poLineId: lineId, receiptLineId: acceptedLine, qty: q('1'), rate: r('103') }] });
        return { id, asked: await postBillNow(ctx, { id }) };
      });
      add(['GET /purchasing/bills/:id'], bill.id, over.id);
      add(['GET /approvals/purchase-bill/:id'], over.asked.approvalId ?? undefined);
      // The posted receipt's reject (batch L2) back to the supplier, posted.
      const rejected = (await su.query<{ id: string }>("select id from radcore.batches where item_id = $1 and batch_no = 'L2'", [base.plain])).rows[0]?.id ?? '';
      const receiptLine = (await run((ctx) => getReceiptById(ctx, { id: posted.id }))).lines[0]?.id ?? '';
      const sentBack = await run(async (ctx) => {
        const { id } = await addSupplierReturn(ctx, { supplierId: base.supplier, businessDate: DATE, locationId: base.rejects, reason: 'Torn bag',
          notes: null, lines: [{ receiptLineId: receiptLine, qty: q('1'), batches: [{ batchId: rejected, qty: q('1') }], serials: [] }] });
        await postSupplierReturn(ctx, { id });
        return id;
      });
      add(['GET /purchasing/returns/:id', 'GET /purchasing/returns/:id/pdf'], sentBack);
    });

    // Job work: a challan to the job worker, and a receipt bringing one back.
    await step('job work', async () => {
      const challan = await run((ctx) => addChallan(ctx, { fromId: base.stores, partyId: base.jobWorker, businessDate: DATE, notes: null,
        lines: [{ itemId: base.plain, qty: q('2'), batches: [{ batchId: b1, qty: q('2') }], serials: [] }] }));
      const line = (await run((ctx) => getChallanById(ctx, { id: challan.id }))).lines[0]?.id ?? '';
      const none = { qty: q('0'), batches: [], serials: [] };
      const back = await run((ctx) => addJobWorkReceipt(ctx, { challanId: challan.id, locationId: base.stores, businessDate: DATE, notes: null,
        lines: [{ challanLineId: line, made: null, used: none, back: { qty: q('1'), batches: [{ batchId: b1, qty: q('1') }], serials: [] }, lost: none }] }));
      add(['GET /stock/job-work/challans/:id', 'GET /stock/job-work/challans/:id/pdf'], challan.id);
      add(['GET /stock/job-work/receipts/:id'], back.id);
    });

    // CRM: a lead, a campaign and its spend.
    await step('crm', async () => {
      const lead = await run((ctx) => captureEnquiry(ctx, { phone: `9${String(randomBytes(4).readUInt32BE() % 1_000_000_000).padStart(9, '0')}`,
        source: 'manual' }));
      add(['GET /leads/:id'], lead.id ?? undefined);
      const form = (await run((ctx) => leadSourcesList(ctx))).sources.find((s) => s.door && s.channel === 'form');
      const campaign = await run((ctx) => addCampaign(ctx, { name: `Sweep ${tag()}`, sourceId: form?.id ?? '' }));
      await run((ctx) => addAdSpend(ctx, { campaignId: campaign.id, fromDate: DATE, toDate: DATE, amount: m('100'), note: null }));
    });
    // Price lists: one approved by someone else, one waiting for approval; each list, version, its rates and changes.
    await step('price lists', async () => {
      const sent = async (rate: string) => {
        const { id, draftId } = await run((ctx) => addList(ctx, { name: `Sweep ${tag()}`, taxInclusive: true }));
        await run((ctx) => putRates(ctx, { id: draftId, rates: [{ itemId: base.plain, rate: r(rate) }] }));
        return { id, draftId, asked: await run((ctx) => askPriceListApproval(ctx, { id: draftId })) };
      };
      const live = await sent('120');
      await runAs(buyer)((ctx) => decideApproval(ctx, priceListApproval, live.asked.id, { decision: 'approve', versionHash: live.asked.versionHash }));
      const waiting = await sent('125');
      add(['GET /price-lists/:id', 'GET /price-lists/:id/price'], live.id, waiting.id);
      add(['GET /price-lists/versions/:id', 'GET /price-lists/versions/:id/changes', 'GET /price-lists/versions/:id/rates'], live.draftId, waiting.draftId);
      add(['GET /approvals/price-list/:id'], live.asked.id, waiting.asked.id);
    });

    // Overrides: an order, a delivery and an invoice, each a draft with its override asked (the ask needs no failed check).
    await step('overrides', async () => {
      const d = await postedDelivery(run, su, DATE);
      const placeId = (await run((ctx) => getDeliveryById(ctx, { id: d.deliveryId }))).locationId;
      const batchId = await batchOf(d.itemId);
      const order = () => run((ctx) => addOrder(ctx, { partyId: d.partyId, businessDate: DATE, notes: null,
        lines: [{ itemId: d.itemId, qty: q('1'), rate: r('80000'), discountPercent: percentString({ max: '100' }).parse('0') }] }));
      const draftOrder = await order();
      const confirmed = await order();
      const asked = await run(async (ctx) => {
        await confirmOrderNow(ctx, { id: confirmed.id });
        const orderLineId = (await getOrderById(ctx, { id: confirmed.id })).lines[0]?.id ?? '';
        const { id: deliveryId } = await addDelivery(ctx, { orderId: confirmed.id, locationId: placeId, businessDate: DATE, notes: null,
          lines: [{ orderLineId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [] }] });
        const { id: invoiceId } = await addInvoice(ctx, { partyId: d.partyId, businessDate: DATE, notes: null, shipTo: null,
          lines: [{ deliveryLineId: d.deliveryLineId, qty: q('1') }] });
        return { order: await askOrderOverride(ctx, { id: draftOrder.id }), delivery: await askDeliveryOverride(ctx, { id: deliveryId }),
          invoice: await askInvoiceOverride(ctx, { id: invoiceId }) };
      });
      add(['GET /approvals/sales-order-override/:id'], asked.order.id);
      add(['GET /approvals/sales-delivery-override/:id'], asked.delivery.id);
      add(['GET /approvals/sales-invoice-override/:id'], asked.invoice.id);
    });

    // A cash payment past the day's limit (10,000.00 by default) waits for approval.
    await step('cash limit', async () => {
      const held = await run(async (ctx) => recordPayment(ctx, { kind: 'payment', partyId: base.supplier, businessDate: DATE,
        amount: m('10000.01'), accountId: await systemAccountId(ctx, 'cash') }));
      const request = (await su.query<{ id: string }>("select id from radcore.approvals where kind = 'cash-limit' and record_id = $1",
        [held.id])).rows[0]?.id;
      add(['GET /approvals/cash-limit/:id'], request);
    });

    // A move back of the period lock, waiting (RAD-157). Written as rows, not through askToUnlock: that needs the run's one
    // period lock set, which every other file's postings would meet.
    await step('period unlock', async () => {
      const { rows: [asked] } = await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
        insert into radcore.period_unlock_requests (kind, through, reason, lock_was) select 'move_back', '2020-01-31', 'Sweep', '2020-02-29'
        from p returning id`);
      const { rows: [request] } = await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
        insert into radcore.approvals (kind, record_id, version_digest, requested_by) select 'period-unlock', $1, repeat('0', 64), 'system:test'
        from p returning id`, [asked?.id]);
      add(['GET /approvals/period-unlock/:id'], request?.id);
    });

    // Cash paid into the bank (RAD-165, F19).
    await step('transfer', async () => {
      const moved = await run(async (ctx) => recordTransfer(ctx, { fromAccountId: await systemAccountId(ctx, 'cash'),
        toAccountId: await systemAccountId(ctx, 'bank'), amount: m('10'), businessDate: DATE }));
      add(['GET /transfers/:id'], moved.id);
    });

    // A bank account's statement layout and an imported statement with a line (RAD-159), as rows: the import itself runs in
    // the worker, which this file doesn't start.
    await step('bank statement', async () => {
      const q = (text: string, values: unknown[]) => su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
        ${text}`, values).then((r) => r.rows[0]?.id ?? '');
      const bank = await q(`insert into radcore.accounts (name, type, parent_id) select $1, 'asset', a.id from radcore.accounts a, p
        where a.system_key = 'bank' returning id`, [`Sweep bank ${tag()}`]);
      await q(`insert into radcore.statement_formats (account_id, date_column, narration_column, reference_column, withdrawal_column,
        deposit_column, balance_column, newest_first) select $1, 'Date', 'Narration', null, 'Withdrawal', 'Deposit', 'Balance', false from p`, [bank]);
      const file = await q(`insert into radcore.files (kind, store_key, filename, content_type, size, status)
        select 'statement', $1, 'statement.csv', 'text/csv', 10, 'ready' from p returning id`, [`statement/${randomUUID()}`]);
      const imported = await q(`insert into radcore.statement_imports (account_id, file_id, status, new_lines, present_lines, refusals)
        select $1, $2, 'imported', 1, 0, '[]'::jsonb from p returning id`, [bank, file]);
      await q(`insert into radcore.bank_statement_lines (account_id, import_id, row_no, value_date, narration, reference, direction, amount, balance)
        select $1, $2, 2, $3, 'NEFT', '', 'in', 100, 100 from p`, [bank, imported, DATE]);
      add(['GET /bank/accounts/:id/statement-format'], bank);
      add(['GET /bank/statement-imports/:id'], imported);
    });

    // A booking: a serialised unit promised to a confirmed order line, with an advance.
    await step('booking', async () => {
      // The customer's credit and price for the scooter, so its order confirms without an override.
      await run((ctx) => setCreditTerms(ctx, { id: base.customer, creditDays: 30, creditLimit: m('100000000'), reason: 'Sweep' }));
      await priceListFrom(su, DATE, { [base.serial]: '70000' }, { partyId: base.customer });
      const booked = await run(async (ctx) => {
        const { id: orderId } = await addOrder(ctx, { partyId: base.customer, businessDate: DATE, notes: null, lines: [{ itemId: base.serial,
          qty: q('1'), rate: r('70000'), discountPercent: percentString({ max: '100' }).parse('0') }] });
        await confirmOrderNow(ctx, { id: orderId });
        const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
        return addBooking(ctx, { orderLineId, serialNo: base.serials[0] ?? '',
          advance: { amount: m('1000'), accountId: await systemAccountId(ctx, 'bank'), businessDate: DATE } });
      });
      add(['GET /sales/bookings/:id'], booked.id);
    });

    // An export started: queued, as the worker (not run here) leaves it until it takes the job.
    await step('export', async () => {
      add(['GET /exports/:id'], (await run((ctx) => startMastersExport(ctx, { filter: {} }))).exportId);
    });
    return ids;
  }

  /** The inputs a route needs beyond its ids: a printout's paper, and the filters a list can't be read without. */
  const inputFor = (path: string, ids: Ids): Record<string, unknown> => {
    if (path.endsWith('/pdf')) return { paper: 'a4' };
    const party = ids['GET /parties/:id']?.[0] ?? '';
    const item = ids['GET /items/:id']?.[0] ?? '';
    const known: Record<string, Record<string, unknown>> = {
      'GET /crm/cost-per-lead': { fromDate: DATE, toDate: DATE },
      'GET /parties/:id/statement': { from: DATE, to: DATE },
      'GET /sales/price': { partyId: party, itemId: item, on: DATE },
      'GET /gst/rates/in-force': { hsn: ids['hsn']?.[0] ?? '', on: DATE },
      'GET /admin/audit': { filter: { occurred: { from: DATE, to: DATE } }, limit: 50 },
      'GET /admin/security-events': { filter: { occurred: { from: DATE, to: DATE } }, limit: 50 },
      'GET /price-lists/:id/price': { itemId: item, on: DATE },
      'GET /stock/on-hand': { itemId: item, locationId: ids['stores']?.[0] ?? '', limit: 50 },
    };
    return known[path] ?? {};
  };

  it('answers every GET route without a 5xx, on one of each kind of document', async () => {
    const who = await person('100000000');
    const buyer = await person();
    const seedFailures: string[] = [];
    const ids = await seed(who, buyer, seedFailures);
    const routes = (await apiList()).filter((x) => x.contract.method === 'GET');
    const server = await listen(createApp(cfg, { info: () => undefined, error: () => undefined },
      { db, authenticate: async () => who, routes, secrets: createSecrets(cfg.secrets) }), 0, '127.0.0.1');
    const broken: string[] = [];
    const unreached: string[] = [];
    try {
      for (const route of routes) {
        const key = `GET ${route.contract.path}`;
        const extra = inputFor(key, ids);
        const calls = route.contract.params.length === 0 ? [extra]
          : (ids[key] ?? []).map((id) => ({ ...extra, [route.contract.params[0] ?? 'id']: id }));
        let reached = false;
        const why: string[] = [];
        for (const given of calls) {
          // A list's first page, with no filter, where the route takes one (lib-common's listInput).
          const input = route.contract.input.safeParse(given).success ? given : { filter: {}, limit: 50, ...given };
          const checked = route.contract.input.safeParse(input);
          if (!checked.success) {
            why.push(`input: ${checked.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
            continue;
          }
          const sent = requestFor(route.contract, input);
          const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { headers: { origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin' } });
          const body = res.headers.get('content-type')?.startsWith('application/json') === true ? await res.text() : '';
          if (res.status >= 500) broken.push(`${key} ${JSON.stringify(input)}: ${res.status} ${body.slice(0, 300)}`);
          else if (res.status < 400) reached = true;
          else why.push(`${res.status} ${body.slice(0, 160)}`);
        }
        if (!reached && !(key in NOT_REACHED)) unreached.push(`${key}: ${calls.length === 0 ? 'no id seeded' : why.join(' | ')}`);
      }
    } finally {
      await server.stop();
    }
    const mounted = new Set(routes.map((x) => `GET ${x.contract.path}`));
    expect({ seedFailures, broken, unreached, stale: Object.keys(NOT_REACHED).filter((k) => !mounted.has(k)) })
      .toEqual({ seedFailures: [], broken: [], unreached: [], stale: [] });
  });
});
