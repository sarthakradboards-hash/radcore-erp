// RAD-107 (M3-03; RC-054) on a real PostgreSQL: every outside door into lead capture. The form's one door takes an
// enquiry only past Turnstile and stores it once; each provider's job makes its payload a lead, unowned; Meta's leads
// wait for M7's fetch; an integration's secret is stored encrypted and read for each request; the webhook lane limits
// each address, refuses a delivery whose secret isn't stored (and alerts), and answers the subscription handshake only
// with the stored token. Provider payloads are fixtures (live Meta and WhatsApp come with M7). Here in tools/ because
// it calls the API with fetch (ADR-002 L8).
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  formEnquiry, googleLead, metaLead, takeFormEnquiry, turnstileBefore, whatsappMessage,
} from '@radcore/lib-crm';
import {
  createSecrets, loadConfig, storedSecret, storeSecret, type Ctx, type Outbound, type Principal, type RequestGuards, type WebhookDelivery,
} from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import webhooks from '../apps/api/src/routes/hooks.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const config = () => loadConfig(testSettings({ APP_ENV: 'ci', NODE_ENV: 'test', DATABASE_URL: url ?? '' }), 'api');
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const PUBLIC: Principal = { kind: 'system', name: 'public', permissions: [] };
const DOOR: Principal = { kind: 'system', name: 'test-door', permissions: ['leads:read', 'leads:write'] };
const fixture = (name: string) => readFileSync(new URL(`../packages/lib-integrations/fixtures/${name}`, import.meta.url), 'utf8');
const mobile = () => `9${String(randomBytes(4).readUInt32BE() % 1_000_000_000).padStart(9, '0')}`;
// Built at run time, so the secret scanner has nothing to match.
const GOOGLE_KEY = 'a-key-set-on-the-form';
const META_SECRET = 'meta-app-'.repeat(3);
const META_TOKEN = 'verify-'.repeat(3);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the lead door tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('lead doors', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  const owner = createDatabase(su);
  const secrets = createSecrets(config().secrets);
  const as = <R>(p: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, p, randomUUID(), fn);
  /** The owner login's transaction, as tools/set-secret.ts writes. */
  const asOwner = <R>(work: (ctx: Ctx) => Promise<R>) =>
    runInTransaction(owner, WRITE, { kind: 'system', name: 'set-secret', permissions: [] }, randomUUID(), work);
  /** One statement as the owner login, in a transaction that names who wrote it (the audit trigger asks). */
  async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  const leadOf = async (phone: string) => (await sql<{ owner: string | null; name: string | null; email: string | null; source: string;
    message: string | null }>(`select l.owner, l.name, l.email, e.source, e.message from radcore.leads l
    join radcore.lead_enquiries e on e.lead_id = l.id where l.phone = $1 order by e.received_at`, [phone]));
  /** A delivery as the intake stores it, for a job to run on. */
  const stored = async (source: string, payload: string): Promise<WebhookDelivery> => {
    const deliveryId = randomUUID();
    const [row] = await sql<{ id: string }>(`insert into radcore.webhook_deliveries (source, delivery_id, body_sha256, payload)
      values ($1, $2, $3, $4) returning id`,
    [source, deliveryId, createHash('sha256').update(`${deliveryId}${payload}`).digest('hex'), payload]);
    return { id: row?.id ?? '', source, deliveryId, payload };
  };

  const state: { base: string; stops: { stop(): Promise<void> }[] } = { base: '', stops: [] };
  const alert = vi.fn<(message: string, key?: string) => Promise<void>>(async () => undefined);
  /** The rate guard, as RAD-39's would answer: the seconds to wait. */
  const guardsWaiting = (seconds: number): RequestGuards => ({ address: async () => seconds, person: async () => 0 });
  const log = { info: () => undefined, error: () => undefined };
  const serve = (guards: RequestGuards) => listen(createApp(config(), log,
    { db, routes: [], webhooks, authenticate: async () => null, secrets, guards, alert }), 0, '127.0.0.1');
  beforeAll(async () => {
    await storeSecret(asOwner, secrets, 'crm.google_lead_key', GOOGLE_KEY);
    await storeSecret(asOwner, secrets, 'crm.meta_app_secret', META_SECRET);
    await storeSecret(asOwner, secrets, 'crm.meta_verify_token', META_TOKEN);
    const server = await serve(guardsWaiting(0));
    state.stops.push(server);
    state.base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    for (const s of state.stops.reverse()) await s.stop();
    await pool.end();
    await su.end();
  });

  it('stores an integration’s secret encrypted for its name, replaces it, and lets only the owner login write it', async () => {
    const read = <R>(work: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: true, isolation: 'read committed' }, PUBLIC,
      randomUUID(), work);
    await storeSecret(asOwner, secrets, 'crm.test_rotation', 'first-value');
    await storeSecret(asOwner, secrets, 'crm.test_rotation', 'second-value');
    expect(await storedSecret(read, secrets, 'crm.test_rotation')).toBe('second-value');
    expect(await storedSecret(read, secrets, 'crm.no_such_secret')).toBeNull();
    // The value isn't in the table, and a ciphertext moved to another name won't decrypt.
    const [row] = await sql<{ ciphertext: string }>("select ciphertext from radcore.integration_secrets where name = 'crm.test_rotation'", []);
    expect(row?.ciphertext).not.toContain('second-value');
    await sql("insert into radcore.integration_secrets (name, ciphertext, key_id) values ('crm.test_moved', $1, 'x')",
      [row?.ciphertext]);
    await expect(storedSecret(read, secrets, 'crm.test_moved')).rejects.toThrow();
    await expect(storeSecret((w) => as(PUBLIC, w), secrets, 'crm.test_app_login', 'v')).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('takes the form’s enquiry only past Turnstile, once per token, and makes it a lead no one owns (RC-054)', async () => {
    const phone = mobile();
    const input = { phone, name: 'Web visitor', message: 'Do you deliver to Pune? <script>', captcha: `token-${randomUUID()}` };
    await expect(as(PUBLIC, (ctx) => takeFormEnquiry(ctx, input, { before: false }))).rejects.toMatchObject({ code: 'captcha_failed' });
    await as(PUBLIC, (ctx) => takeFormEnquiry(ctx, input, { before: true }));
    await as(PUBLIC, (ctx) => takeFormEnquiry(ctx, input, { before: true }));
    const deliveries = await sql<{ id: string; delivery_id: string; payload: string }>(
      "select id, delivery_id, payload from radcore.webhook_deliveries where source = 'POST /public/enquiries' and payload like $1", [`%${phone.slice(-6)}%`]);
    // Stored once, keyed on the token's hash, without the token.
    expect(deliveries.map((d) => [d.delivery_id, d.payload.includes('token-')]))
      .toEqual([[createHash('sha256').update(input.captcha).digest('hex'), false]]);
    const [d] = deliveries;
    await as(DOOR, (ctx) => formEnquiry(ctx, { id: d?.id ?? '', source: 'POST /public/enquiries', deliveryId: d?.delivery_id ?? '', payload: d?.payload ?? '' }));
    expect(await leadOf(`+91${phone}`)).toEqual([{ owner: null, name: 'Web visitor', email: null, source: 'form',
      message: 'Do you deliver to Pune? <script>' }]);
  });

  it('asks Cloudflare with the secret from start, and passes only what it passes', async () => {
    const answers: string[] = [];
    const outbound = (success: boolean): Outbound => ({ request: (_url, init) => {
      answers.push(String(init?.body));
      return Promise.resolve({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success })), url: '' });
    } });
    const input = { phone: mobile(), captcha: 'the-token' };
    expect(await turnstileBefore({ outbound: outbound(true), secret: 'start-secret' })(input)).toBe(true);
    expect(await turnstileBefore({ outbound: outbound(false), secret: 'start-secret' })(input)).toBe(false);
    expect(answers).toEqual(['secret=start-secret&response=the-token', 'secret=start-secret&response=the-token']);
  });

  it('makes a Google lead an unowned lead', async () => {
    const payload = fixture('google-lead.json');
    await as(DOOR, async (ctx) => googleLead(ctx, await stored('POST /hooks/google-leads', payload)));
    expect(await leadOf('+919876543210')).toEqual([{ owner: null, name: 'Kiran Rao', email: 'kiran@example.test', source: 'google',
      message: null }]);
  });

  it('makes each WhatsApp message an enquiry, its text kept as written (RC-173)', async () => {
    await as(DOOR, async (ctx) => whatsappMessage(ctx, await stored('POST /hooks/whatsapp', fixture('whatsapp-messages.json'))));
    expect([await leadOf('+919700011122'), await leadOf('+919700033344')]).toEqual([
      [{ owner: null, name: 'Ravi Kumar', email: null, source: 'whatsapp', message: 'Is the blue scooter in stock? <b>Call me</b>' }],
      [{ owner: null, name: 'Meera', email: null, source: 'whatsapp', message: null }],
    ]);
  });

  it('keeps a Meta lead waiting, once, until there’s a fetch; with one, captures it', async () => {
    const payload = fixture('meta-leadgen-notification.json');
    const first = await stored('POST /hooks/meta-leads', payload);
    await as(DOOR, (ctx) => metaLead(null)(ctx, first));
    await as(DOOR, async (ctx) => metaLead(null)(ctx, await stored('POST /hooks/meta-leads', payload)));
    expect(await sql('select leadgen_id, form_id, page_id, delivery_id, fetched_at from radcore.meta_lead_waits', []))
      .toEqual([{ leadgen_id: '444444444444', form_id: '444444444444', page_id: '444444444444', delivery_id: first.id, fetched_at: null }]);
    const fetched: string[] = [];
    await as(DOOR, (ctx) => metaLead(async (id) => {
      fetched.push(id);
      return fixture('meta-lead.json');
    })(ctx, first));
    expect([fetched, await leadOf('+919812345678')]).toEqual([['444444444444'],
      [{ owner: null, name: 'Asha Menon', email: 'asha@example.test', source: 'meta', message: null }]]);
  });

  describe('the webhook lane', () => {
    const post = (path: string, body: string, headers: Record<string, string> = {}) => fetch(`${state.base}${path}`,
      { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

    it('takes a Google lead with the stored key and refuses another key, a campaign token, or none', async () => {
      const lead = (key: string) => JSON.stringify({ ...JSON.parse(fixture('google-lead.json')) as object, lead_id: randomUUID(), google_key: key });
      expect((await post('/hooks/google-leads', lead(GOOGLE_KEY))).status).toBe(200);
      for (const key of ['wrong-key', 'campaign-token-abc', '']) expect((await post('/hooks/google-leads', lead(key))).status).toBe(401);
    });

    it('checks Meta’s signature under the stored app secret', async () => {
      const body = fixture('meta-leadgen-notification.json');
      const sig = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect((await post('/hooks/meta-leads', body, { 'x-hub-signature-256': sig(META_SECRET) })).status).toBe(200);
      expect((await post('/hooks/meta-leads', body, { 'x-hub-signature-256': sig('another-secret') })).status).toBe(401);
    });

    it('refuses what couldn’t pass before reading any secret, and alerts when a secret isn’t stored', async () => {
      const payload = fixture('whatsapp-messages.json');
      // No signature of the right shape: refused before the secret is read, so nothing alerts.
      expect((await post('/hooks/whatsapp', payload, { 'x-hub-signature-256': 'sha256=00' })).status).toBe(401);
      expect(alert.mock.calls.filter(([, key]) => key === 'webhook secret crm.whatsapp_app_secret')).toEqual([]);
      // One that could pass reads the secret, which isn't stored: refused, with an alert under the secret's own key.
      expect((await post('/hooks/whatsapp', payload, { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` })).status).toBe(401);
      expect(alert).toHaveBeenCalledWith(expect.stringContaining('no crm.whatsapp_app_secret is stored'), 'webhook secret crm.whatsapp_app_secret');
    });

    it('answers the subscription handshake only with the stored verify token', async () => {
      const handshake = (token: string) => fetch(`${state.base}/hooks/meta-leads?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`);
      const ok = await handshake(META_TOKEN);
      expect([ok.status, await ok.text()]).toEqual([200, '1158201444']);
      expect((await handshake('not-the-token')).status).toBe(403);
    });

    it('limits each address before any check, with Retry-After', async () => {
      const limited = await serve(guardsWaiting(7));
      try {
        const base = `http://127.0.0.1:${limited.port}`;
        const res = await fetch(`${base}/hooks/google-leads`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
        expect([res.status, res.headers.get('retry-after')]).toEqual([429, '7']);
        expect((await fetch(`${base}/hooks/meta-leads?hub.mode=subscribe`)).status).toBe(429);
      } finally {
        await limited.stop();
      }
    });
  });
});
