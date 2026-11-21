// RAD-118 (M3-14; ADR-001 §6a, §7a; RC-047) on a real PostgreSQL, as the runtime login: a posted invoice shared by a
// link, under invoices:share. Each test's delivery is committed; its invoice posts inside one transaction that is
// rolled back, with the company profile set there, since the one company row must stay unset for company.test.ts. The
// link's holder opens it in that same transaction (asLink), as the generic handler would after linkPrincipal; the
// handler's own part (token stripped, one not_found, noindex, the use and access_log after commit) is link-routes.test.ts's.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCompanyProfile, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, piiPlan, quantityString, sightOf, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import {
  AppError, linkMaxDays, linkPrincipal, loadConfig, principalId, recordLinkAccess, Settings, type Ctx, type Principal,
} from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addInvoice, addOrder, cancelInvoiceNow, confirmOrderNow, DOCUMENT_LINK_DAYS, getDeliveryById, getOrderById, invoiceByLink,
  invoiceLinks, postDeliveryNow, postInvoiceNow, revokeInvoiceLinkNow, shareInvoiceLink,
} from '@radcore/lib-sales';
import { viewInvoiceLink } from '@radcore/lib-sales/contract';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
import { rawOf } from '../packages/db/src/tx.ts';
import { mayUse } from '../packages/lib-platform/src/scope.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const DAY = 86_400_000;
const VIEW = 'sales.invoice_view';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'invoices:cancel', 'invoices:share', 'parties:write',
  'parties:manage', 'items:write', 'locations:write', 'gst:write', 'company:write', 'cost:read'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Invoice links in a test' };
class RolledBack extends Error {}

/** The same transaction, acting as `p`: its key checks, and the principal the audit trail records. Test-only. */
async function actingAs(ctx: Ctx, p: Principal, settings?: Settings): Promise<Ctx> {
  await rawOf(ctx.tx).execute(sql`select set_config('app.principal', ${principalId(p)}, true)`);
  const can = (permission: string, record?: { owner: string }) => mayUse(p, permission, record);
  const see = (permission: string, record: { owner: string }) => {
    if (!can(permission, record)) throw new AppError('not_found', 'Not found');
  };
  return Object.freeze({ ...ctx, principal: p, can, see, shows: sightOf(p.permissions), ...(settings === undefined ? {} : { settings }) });
}

describe.skipIf(!url || !superUrl)('invoice links', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  /** `fn` in one transaction with the company profile set, then rolled back: what it answers. */
  async function inBooks<R>(fn: (ctx: Ctx) => Promise<R>): Promise<R> {
    let out: R | undefined;
    await run(async (ctx) => {
      await setCompanyProfile(ctx, COMPANY);
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }

  /** A customer in Maharashtra with credit and an address, an item at 5% GST, a confirmed order for one at 80,000.00
   * and its posted delivery: the delivery line an invoice bills. */
  async function delivered() {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse('100000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Notification 1/2017-CT(R)', note: null,
        reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `I-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q('2'), rate: unitPriceString().parse('61250'), batches: [{ batchNo: 'B1', qty: q('2') }] }] });
      return { partyId, itemId, placeId };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '80000' }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return run(async (ctx) => {
      const { id: orderId } = await addOrder(ctx, { partyId: made.partyId, businessDate: DATE, notes: null, lines: [{ itemId: made.itemId,
        qty: q('1'), rate: unitPriceString().parse('80000'), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const { id } = await addDelivery(ctx, { orderId, locationId: made.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q('1'), batches: [{ batchId: batch?.id ?? '', qty: q('1') }], serials: [] }] });
      await postDeliveryNow(ctx, { id });
      return { partyId: made.partyId, deliveryLineId: (await getDeliveryById(ctx, { id })).lines[0]?.id ?? '' };
    });
  }
  type At = Awaited<ReturnType<typeof delivered>>;
  const draft = (ctx: Ctx, at: At) => addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
    lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }] });
  const posted = async (ctx: Ctx, at: At) => {
    const { id } = await draft(ctx, at);
    return { id, ...(await postInvoiceNow(ctx, { id })) };
  };
  /** The link's holder, as the handler makes it from the token: null for a token that's no live link. */
  const asLink = async (ctx: Ctx, token: string) => {
    const holder = await linkPrincipal(ctx, token, VIEW);
    return holder === null ? null : actingAs(ctx, holder);
  };
  const opened = async (ctx: Ctx, token: string) => {
    const as = await asLink(ctx, token);
    if (as === null) return 'not_found' as const;
    // A live link to an invoice no longer posted gets the same not_found as a dead link.
    const view = await invoiceByLink(as, {}).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'not_found') return 'not_found' as const;
      throw e;
    });
    await actingAs(ctx, staff);
    return view;
  };
  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

  it("shares a posted invoice as issued: the buyer's name and address in full, and no phone, email, notes or cost", async () => {
    const at = await delivered();
    const out = await inBooks(async (ctx) => {
      const inv = await posted(ctx, at);
      const link = await shareInvoiceLink(ctx, { id: inv.id });
      return { inv, link, view: await opened(ctx, link.token) };
    });
    if (out.view === 'not_found') throw new Error('the link did not open');
    // As the handler answers it: its output contract marks nothing to mask, so the holder sees what the invoice carries.
    expect(piiPlan(viewInvoiceLink.output)).toBeNull();
    expect(viewInvoiceLink.output.parse(out.view)).toEqual(out.view);
    expect(out.link.path).toBe(`/l/invoice#token=${out.link.token}`);
    expect([out.view.number, out.view.total, out.view.issuer.legalName, out.view.buyer]).toEqual([out.inv.number, out.inv.total,
      'Radboards Pvt Ltd', { name: expect.stringMatching(/^Party /), gstin: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune',
        pincode: '411001', stateCode: '27' }]);
    expect(out.view.lines.map((l) => [l.name, l.unit, l.qty, l.rate, l.taxable, l.lineTotal])).toEqual([['Scooter', 'NOS', '1.000', '80000.000000',
      '80000.00', '84000.00']]);
    expect(JSON.stringify(out.view)).not.toMatch(/cost|phone|email|notes|createdBy|owner/i);
  });

  it("answers only the link's own invoice, for its own action; not_found for a staff request or a link for anything else", async () => {
    const [at, other] = [await delivered(), await delivered()];
    const out = await inBooks(async (ctx) => {
      const a = await posted(ctx, at);
      const b = await posted(ctx, other);
      const link = await shareInvoiceLink(ctx, { id: a.id });
      const as = await asLink(ctx, link.token);
      if (as === null) throw new Error('the link did not open');
      // The body naming B changes nothing: the read is by the link's own record.
      const asked = await invoiceByLink(as, { id: b.id });
      const holder = (action: string, recordId: string): Principal => ({ kind: 'link', linkId: link.id, action, recordId, permissions: [] });
      const refused = [await failure(invoiceByLink(await actingAs(ctx, staff), {})),
        await failure(invoiceByLink(await actingAs(ctx, holder('sales.estimate_view', a.id)), {})),
        await failure(invoiceByLink(await actingAs(ctx, holder(VIEW, randomUUID())), {}))];
      await actingAs(ctx, staff);
      return { a: a.number, got: asked.number, refused };
    });
    expect(out).toEqual({ a: out.a, got: out.a, refused: ['not_found', 'not_found', 'not_found'] });
  });

  it('logs each opening against the invoice, by the link', async () => {
    const at = await delivered();
    const out = await inBooks(async (ctx) => {
      const inv = await posted(ctx, at);
      const link = await shareInvoiceLink(ctx, { id: inv.id });
      for (let i = 0; i < 2; i++) {
        const as = await asLink(ctx, link.token);
        if (as === null) throw new Error('the link did not open');
        await invoiceByLink(as, {});
        await recordLinkAccess(as);
      }
      await actingAs(ctx, staff);
      const { rows } = await rawOf(ctx.tx).execute(sql`select record_table, record_id from radcore.access_log
        where created_by = ${`link:${link.id}`}`) as unknown as { rows: unknown[] };
      return { id: inv.id, rows };
    });
    expect(out.rows).toEqual([{ record_table: 'invoices', record_id: out.id }, { record_table: 'invoices', record_id: out.id }]);
  });

  it('refuses a draft (wrong_status); a cancelled invoice\'s link answers like a dead one', async () => {
    const at = await delivered();
    const out = await inBooks(async (ctx) => {
      const { id: draftId } = await draft(ctx, at);
      const refused = await failure(shareInvoiceLink(ctx, { id: draftId }));
      await postInvoiceNow(ctx, { id: draftId });
      const link = await shareInvoiceLink(ctx, { id: draftId });
      await cancelInvoiceNow(ctx, { id: draftId, businessDate: DATE, reason: 'Billed in error' });
      return { refused, view: await opened(ctx, link.token) };
    });
    expect(out).toEqual({ refused: 'wrong_status', view: 'not_found' });
  });

  it('lasts sales.document_link_days (30), never past platform.public_link_max_days; a revoked link answers like a dead one', async () => {
    const at = await delivered();
    const out = await inBooks(async (ctx) => {
      const inv = await posted(ctx, at);
      const plain = await shareInvoiceLink(ctx, { id: inv.id });
      const capped = await shareInvoiceLink({ ...ctx, settings: new Settings([{ key: linkMaxDays.key, value: 10 }]) }, { id: inv.id });
      const shorter = await shareInvoiceLink({ ...ctx, settings: new Settings([{ key: DOCUMENT_LINK_DAYS.key, value: 5 }]) }, { id: inv.id });
      const listed = await invoiceLinks(ctx, { id: inv.id });
      const life = (id: string) => {
        const l = listed.items.find((x) => x.id === id);
        return l === undefined ? -1 : days(l.createdAt, l.expiresAt);
      };
      await revokeInvoiceLinkNow(ctx, { id: inv.id, linkId: plain.id });
      return { lives: [life(plain.id), life(capped.id), life(shorter.id)], revoked: await opened(ctx, plain.token),
        still: (await opened(ctx, capped.token)) !== 'not_found',
        revokedAt: (await invoiceLinks(ctx, { id: inv.id })).items.find((l) => l.id === plain.id)?.revokedAt !== null };
    });
    expect(out).toEqual({ lives: [30, 10, 5], revoked: 'not_found', still: true, revokedAt: true });
  });

  it('refuses a document link life longer than any link may last, on the settings screen', async () => {
    const check = DOCUMENT_LINK_DAYS.check;
    if (check === undefined) throw new Error('sales.document_link_days has no check');
    const ctx = { settings: new Settings([{ key: linkMaxDays.key, value: 10 }]) } as unknown as Ctx;
    expect([await check(ctx, 10), typeof await check(ctx, 11)]).toEqual([null, 'string']);
  });

  it('at own, reaches only the person\'s own invoices; any link on a reachable invoice can be revoked, by anyone sharing it', async () => {
    const at = await delivered();
    const seller: Principal = { kind: 'user', userId: randomUUID(), permissions: ['invoices:share'], ownScope: ['invoices:share'] };
    const colleague: Principal = { kind: 'user', userId: randomUUID(), permissions: ['invoices:share'] };
    const out = await inBooks(async (ctx) => {
      const inv = await posted(ctx, at);
      const link = await shareInvoiceLink(ctx, { id: inv.id });
      const own = await actingAs(ctx, seller);
      const others = [await failure(shareInvoiceLink(own, { id: inv.id })), await failure(invoiceLinks(own, { id: inv.id })),
        await failure(revokeInvoiceLinkNow(own, { id: inv.id, linkId: link.id }))];
      const all = await actingAs(ctx, colleague);
      const wrongInvoice = await failure(revokeInvoiceLinkNow(all, { id: randomUUID(), linkId: link.id }));
      await revokeInvoiceLinkNow(all, { id: inv.id, linkId: link.id });
      await actingAs(ctx, staff);
      return { others, wrongInvoice, view: await opened(ctx, link.token) };
    });
    expect(out).toEqual({ others: ['not_found', 'not_found', 'not_found'], wrongInvoice: 'not_found', view: 'not_found' });
  });

  it('needs invoices:share: 403 without it', async () => {
    const config = loadConfig(testSettings(), 'api');
    const without: Principal = { kind: 'user', userId: randomUUID(), permissions: ['sales:read', 'invoices:write'] };
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => without, routes: salesRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const id = randomUUID();
      const base = `http://127.0.0.1:${server.port}/sales/invoices/${id}/links`;
      const headers = { 'content-type': 'application/json', origin: config.publicOrigin, 'idempotency-key': randomUUID() };
      const statuses = [(await fetch(base, { method: 'POST', headers, body: '{}' })).status, (await fetch(base, { headers })).status,
        (await fetch(`${base}/${randomUUID()}`, { method: 'DELETE', headers: { ...headers, 'idempotency-key': randomUUID() } })).status];
      expect(statuses).toEqual([403, 403, 403]);
    } finally {
      await server.stop();
    }
  });
});
