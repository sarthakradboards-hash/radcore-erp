// RAD-110 (M3-06; RC-212) on a real PostgreSQL, as the app login: CRM setup, by the architect's rulings.
// - An ignored source's enquiry is stored and set aside: no lead, no join to the number's lead, no one told. Ignoring a
//   door's source is the whole run's, so that case runs in a transaction that rolls back.
// - Only an outside door's source can be ignored: the walk-in one is refused source_not_ignorable over the real route.
// - campaigns:read and campaigns:write are all-only, granted to marketing, not to sales.
// - A live campaign's token tags the enquiry; an ended one's still lets it in, untagged.
// - Cost per lead is the spend recorded within the range over the campaign's enquiries in it, every one counted
//   whoever owns its lead (enquiry-counts.ts's E7 exemption).
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addAdSpend, addCampaign, captureEnquiry, changeLeadSource, costPerLeadIn, endCampaignNow, leadSourcesList, setAsidePage,
} from '@radcore/lib-crm';
import { updateLeadSource } from '@radcore/lib-crm/contract';
import { moneyString, requestFor } from '@radcore/lib-common';
import { loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import crmRoutes from '../apps/api/src/routes/crm.ts';
import { rawOf } from '../packages/db/src/tx.ts';
import { PERMISSIONS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const FORM: Principal = { kind: 'system', name: 'test-form', permissions: ['leads:read', 'leads:write'] };
const SETUP = ['leads:read', 'leads:write', 'leads:setup', 'campaigns:read', 'campaigns:write'];
const marketing: Principal = { kind: 'user', userId: randomUUID(), permissions: SETUP };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const mobile = () => `9${String(randomBytes(4).readUInt32BE() % 1_000_000_000).padStart(9, '0')}`;
const at = (d: string) => new Date(`${d}T06:00:00Z`);
const tokenOf = (path: string) => new URL(path, 'https://x.test').searchParams.get('c') ?? '';
class RolledBack extends Error {}

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the CRM setup tests must run, not skip');
});

// The architect on RAD-110: both campaign keys are all-only (campaigns are no one's records).
it('declares campaigns:read and campaigns:write as all-only keys with no second factor', () => {
  expect(PERMISSIONS.filter((p) => p.key.startsWith('campaigns:')).map((p) => [p.key, p.allOnly, p.secondFactor]))
    .toEqual([['campaigns:read', true, undefined], ['campaigns:write', true, undefined]]);
});

describe.skipIf(!url || !superUrl)('CRM setup', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = <R>(p: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, p, randomUUID(), fn);
  const rows = async <T>(ctx: Ctx, q: ReturnType<typeof sql>) => ((await rawOf(ctx.tx).execute(q)) as unknown as { rows: T[] }).rows;
  const doorSource = async (channel: string) => (await as(marketing, leadSourcesList)).sources.find((s) => s.door && s.channel === channel);

  // RC-212, the architect: stored and set aside. The number already has a lead someone owns; the ignored source's
  // enquiry neither joins it nor tells its owner, and shows on the set-aside list with its phone masked.
  it('sets an ignored source’s enquiry aside: stored, no lead, no join, no one told', async () => {
    const phone = mobile();
    const { rows: [owner] } = await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Sales', 'sales' from p returning id`, [`${letters()}@example.test`]);
    const asha: Principal = { kind: 'user', userId: owner?.id ?? '', permissions: ['leads:read', 'leads:write'] };
    const made = await as(asha, (ctx) => captureEnquiry(ctx, { phone, source: 'manual' }));
    const qr = await doorSource('qr');
    let out: unknown;
    await as(marketing, async (ctx) => {
      await changeLeadSource(ctx, { id: qr?.id ?? '', name: qr?.name ?? '', active: true, ignored: true });
      const answer = await captureEnquiry(ctx, { phone, source: 'qr', message: 'From the poster' });
      const [counts] = await rows<{ enquiries: string; told: string }>(ctx, sql`select
        (select count(*) from radcore.lead_enquiries where lead_id = ${made.id ?? ''})::text as enquiries,
        (select count(*) from radcore.notifications where record_id = ${made.id ?? ''})::text as told`);
      const aside = (await setAsidePage(ctx, { limit: 10, filter: { sourceId: qr?.id ?? '' } })).items[0];
      out = { answer, counts, aside: [aside?.phone.masked.endsWith(phone.slice(-4)), aside?.phone.masked.includes(phone), aside?.message] };
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    expect(out).toEqual({ answer: { repeat: false }, counts: { enquiries: '1', told: '0' }, aside: [true, false, 'From the poster'] });
  });

  // RC-212: only an outside door's source can be ignored. Over the real route, the walk-in one is refused by name.
  it('refuses to ignore the walk-in source, as source_not_ignorable over the real route', async () => {
    const walkIn = await doorSource('walk_in');
    const cfg = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => marketing, routes: crmRoutes }),
      0, '127.0.0.1');
    try {
      const sent = requestFor(updateLeadSource, { id: walkIn?.id ?? '', name: walkIn?.name ?? '', active: true, ignored: true });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
        headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
      expect([res.status, ((await res.json()) as { code?: string }).code]).toEqual([422, 'source_not_ignorable']);
    } finally {
      await server.stop();
    }
    expect((await doorSource('walk_in'))?.ignored).toBe(false);
  });

  // The architect on RAD-110: marketing starts with both campaign keys, sales with neither, and an `own` grant of
  // either is refused by the database.
  it('grants both campaign keys to marketing and neither to sales, at all only', async () => {
    const { rows: held } = await su.query<{ role: string; permission: string }>(`select role, permission from radcore.role_grants
      where permission like 'campaigns:%' and role in ('marketing', 'sales') order by role, permission`);
    expect(held).toEqual([{ role: 'marketing', permission: 'campaigns:read' }, { role: 'marketing', permission: 'campaigns:write' }]);
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const refused = await c.query("insert into radcore.role_grants (role, permission, scope) values ('sales', 'campaigns:read', 'own')")
        .then(() => 'ok', (e: unknown) => (e as { constraint?: string }).constraint);
      expect(refused).toBe('ck_role_grants_scope');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  // A live campaign's token tags the enquiry with it and its source; an ended one's lets the enquiry in, untagged.
  it('tags an enquiry with a live campaign, and lets an ended one’s in with none', async () => {
    const form = await doorSource('form');
    const made = await as(marketing, (ctx) => addCampaign(ctx, { name: `Poster ${letters()}`, sourceId: form?.id ?? '' }));
    const enquire = (phone: string) => as(FORM, (ctx) => captureEnquiry(ctx, { phone, source: 'form', campaign: tokenOf(made.path) }));
    const live = mobile();
    await enquire(live);
    await as(marketing, (ctx) => endCampaignNow(ctx, { id: made.id }));
    const ended = mobile();
    await enquire(ended);
    const tagged = async (phone: string) => (await su.query<{ campaign: string | null; source: string }>(`select e.campaign_id as campaign,
      e.source_id as source from radcore.lead_enquiries e join radcore.leads l on l.id = e.lead_id where l.phone = $1`, [`+91${phone}`])).rows[0];
    expect([made.path.startsWith('/enquiry?c='), await tagged(live), await tagged(ended)])
      .toEqual([true, { campaign: made.id, source: form?.id }, { campaign: null, source: form?.id }]);
  });

  // Cost per lead: the spend recorded within the range over the campaign's enquiries in it. The enquiries' leads are no
  // one's (the form's), and a marketing role at `own` scope still counts them all.
  it('works cost per lead out as spend in the range over the campaign’s enquiries in it, whoever owns the leads', async () => {
    const form = await doorSource('form');
    const made = await as(marketing, (ctx) => addCampaign(ctx, { name: `Diwali ${letters()}`, sourceId: form?.id ?? '' }));
    for (const day of ['2033-04-05', '2033-04-20', '2033-05-02']) {
      await as(FORM, (ctx) => captureEnquiry(ctx, { phone: mobile(), source: 'form', campaign: tokenOf(made.path), receivedAt: at(day) }));
    }
    await as(marketing, (ctx) => addAdSpend(ctx, { campaignId: made.id, fromDate: '2033-04-01', toDate: '2033-04-30', amount: moneyString().parse('1000'),
      note: null }));
    await as(marketing, (ctx) => addAdSpend(ctx, { campaignId: made.id, fromDate: '2033-05-01', toDate: '2033-05-31', amount: moneyString().parse('500'),
      note: null }));
    const ownOnly: Principal = { ...marketing, ownScope: ['leads:read', 'leads:write'] };
    const april = await as(ownOnly, (ctx) => costPerLeadIn(ctx, { fromDate: '2033-04-01', toDate: '2033-04-30' }));
    expect(april.campaigns.find((c) => c.id === made.id)).toEqual({ id: made.id, name: expect.stringMatching(/^Diwali /), spend: '1000.00',
      enquiries: 2, costPerLead: '500.00' });
  });
});
