// RAD-118 (M3-14; ADR-001 §6a, §7a; RC-047) on a real PostgreSQL, as the runtime login: a posted invoice shared by a
// link, under invoices:share. Each test's delivery is committed; its invoice posts inside one transaction that is
// rolled back, under the committed company profile (tools/test-database.ts) and never rewrites it. The
// link's holder opens it in that same transaction (asLink), as the generic handler would after linkPrincipal; the
// handler's own part (token stripped, one not_found, noindex, the use and access_log after commit) is link-routes.test.ts's.
import { randomUUID } from 'node:crypto';
import { piiPlan, quantityString, sightOf, type UnitCondition } from '@radcore/lib-common';
import {
  AppError, linkMaxDays, linkPrincipal, loadConfig, principalId, recordLinkAccess, Settings, type Ctx, type Principal,
} from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addInvoice, cancelInvoiceNow, DOCUMENT_LINK_DAYS, invoiceByLink, invoiceLinks, postInvoiceNow, remindWithLink, revokeInvoiceLinkNow,
  shareInvoiceLink,
} from '@radcore/lib-sales';
import { viewInvoiceLink } from '@radcore/lib-sales/contract';
import { testSettings } from '@radcore/test-helpers';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
import { rawOf } from '../packages/db/src/tx.ts';
import { mayUse } from '../packages/lib-platform/src/scope.ts';
import { postedDelivery } from './delivered-fixture.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const DAY = 86_400_000;
const VIEW = 'sales.invoice_view';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'invoices:cancel', 'invoices:share', 'parties:write',
  'parties:manage', 'items:write', 'locations:write', 'gst:write', 'company:write', 'cost:read', 'receivables:read', 'receivables:remind'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const q = (s: string) => quantityString().parse(s);
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
      // The committed profile (tools/test-database.ts) is the one these tests sell under; rewriting it here took the company
      // row exclusively for the whole test, and deadlocked against period-lock tests (RAD-76).
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }

  const delivered = (condition?: UnitCondition) => postedDelivery(run, su, DATE, condition);
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
    const view = await invoiceByLink(as).catch((e: unknown) => {
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

  // auditor-2 on #289: the buyer's own copy says what the staff's does. An ex-demo unit's line, opened by its link,
  // shows demo; a new unit's shows none (the architect's ruling on RAD-112).
  it('shows the buyer, by the link, the condition the units left with', async () => {
    const out = [];
    for (const condition of ['demo', 'new'] as const) {
      const at = await delivered(condition);
      out.push(await inBooks(async (ctx) => {
        const inv = await posted(ctx, at);
        const view = await opened(ctx, (await shareInvoiceLink(ctx, { id: inv.id })).token);
        return view === 'not_found' ? 'not_found' : view.lines[0]?.unitCondition;
      }));
    }
    expect(out).toEqual(['demo', null]);
  });

  it("answers only the link's own invoice, for its own action; not_found for a staff request or a link for anything else", async () => {
    const [at, other] = [await delivered(), await delivered()];
    const out = await inBooks(async (ctx) => {
      const a = await posted(ctx, at);
      await posted(ctx, other);
      const link = await shareInvoiceLink(ctx, { id: a.id });
      const as = await asLink(ctx, link.token);
      if (as === null) throw new Error('the link did not open');
      // B posted beside it changes nothing: the read is by the link's own record. Ids in the body never reach the
      // service (link-routes.test.ts).
      const asked = await invoiceByLink(as);
      const holder = (action: string, recordId: string): Principal => ({ kind: 'link', linkId: link.id, action, recordId, permissions: [] });
      const refused = [await failure(invoiceByLink(await actingAs(ctx, staff))),
        await failure(invoiceByLink(await actingAs(ctx, holder('sales.estimate_view', a.id)))),
        await failure(invoiceByLink(await actingAs(ctx, holder(VIEW, randomUUID()))))];
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
        await invoiceByLink(as);
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

  // RAD-119 (the architect's ruling): a reminder carries a new link to the oldest overdue invoice, its token in the
  // answer only. The reminder row keeps the link's id, and neither it nor its audit rows hold the token.
  it("sends a reminder with a new link to the party's invoice, its token in the answer only", async () => {
    const at = await delivered();
    const out = await inBooks(async (ctx) => {
      const inv = await posted(ctx, at);
      const sent = await remindWithLink(ctx, { id: at.partyId, channel: 'whatsapp' });
      const token = sent.link?.path.split('#token=')[1] ?? '';
      const view = await opened(ctx, token);
      const q = async (query: ReturnType<typeof sql>) => ((await rawOf(ctx.tx).execute(query)) as unknown as { rows: { t: string }[] }).rows.map((r) => r.t);
      const kept = [...await q(sql`select r::text as t from radcore.payment_reminders r where r.id = ${sent.id}`),
        ...await q(sql`select a::text as t from radcore.audit_log a where a.table_name = 'payment_reminders' and a.record_id = ${sent.id}`)];
      const [row] = await q(sql`select link_id::text as t from radcore.payment_reminders where id = ${sent.id}`);
      return { number: inv.number, sent, token, view, kept, row };
    });
    expect([out.sent.noLink, out.token.length > 40, out.view === 'not_found' ? null : out.view.number, out.row]).toEqual([null, true,
      out.number, out.sent.link?.id]);
    expect(out.sent.text).not.toContain(out.token);
    expect([out.kept.length >= 2, out.kept.some((t) => t.includes(out.token))]).toEqual([true, false]);
  });

  it('sends the reminder without a link to someone who may not share the invoice (no_share_key)', async () => {
    const at = await delivered();
    const collector: Principal = { kind: 'user', userId: randomUUID(), permissions: ['receivables:read', 'receivables:remind'] };
    const out = await inBooks(async (ctx) => {
      await posted(ctx, at);
      const sent = await remindWithLink(await actingAs(ctx, collector), { id: at.partyId, channel: 'phone' });
      await actingAs(ctx, staff);
      return sent;
    });
    expect([out.link, out.noLink]).toEqual([null, 'no_share_key']);
  });

  it('answers sharing a draft with 422 wrong_status, through the route (the auditor on #287)', async () => {
    const at = await delivered();
    const { id } = await run((ctx) => draft(ctx, at));
    const config = loadConfig(testSettings(), 'api');
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => staff, routes: salesRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/sales/invoices/${id}/links`, { method: 'POST', body: '{}',
        headers: { 'content-type': 'application/json', origin: config.publicOrigin, 'idempotency-key': randomUUID() } });
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([422, 'wrong_status']);
    } finally {
      await server.stop();
    }
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
