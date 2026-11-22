// RAD-109 (M3-05; RC-041) on a real PostgreSQL, as the app login: working a lead through the pipeline. A list is a
// page of the person's own leads with their numbers masked; stages, lost reasons, follow-ups, plans and quick replies
// keep to the CRM's own lists and land on the lead's timeline; a due follow-up tells its owner once. Each test makes its
// own people, numbers and list items; the starting items 0059 seeds are only read.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addLostReason, addPlan, addQuickReply, assignLeadOwner, captureEnquiry, changeLostReason, changePlan, followUpDone, leadById, leadLists,
  listLeadsPage, moveLeadStage, putOnPlan, quickReplyText, tellFollowUpsDue, updateLeadDetails,
} from '@radcore/lib-crm';
import { listLeads } from '@radcore/lib-crm/contract';
import { addDays, moneyString, piiPlan, requestFor } from '@radcore/lib-common';
import { loadConfig, myNotificationsPage, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import crmRoutes from '../apps/api/src/routes/crm.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const WATCH: Principal = { kind: 'system', name: 'follow-ups-due', permissions: ['leads:read'] };
/** Marketing, who keeps the CRM's lists. */
const SETUP: Principal = { kind: 'system', name: 'test-setup', permissions: ['leads:read', 'leads:setup'] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const mobile = () => `9${String(randomBytes(4).readUInt32BE() % 1_000_000_000).padStart(9, '0')}`;
// The run's date, faked (RC-156): before every lead date the other lead tests use, so this file's due follow-ups job
// never finds their leads.
const TODAY = '2026-01-15';

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the pipeline tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('pipeline', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  beforeAll(() => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T06:00:00Z`), toFake: ['Date'] });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await pool.end();
    await su.end();
  });
  const as = <R>(p: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, p, randomUUID(), fn);
  async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
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
  const person = async () => (await owner<{ id: string }>(
    "insert into radcore.users (email, display_name, role) values ($1, $2, 'sales') returning id",
    [`${letters()}@example.test`, `Sales ${letters()}`]))[0]?.id ?? '';
  /** A salesperson: their own leads only, and no personal data. */
  const sales = (userId: string): Principal => ({ kind: 'user', userId, permissions: ['leads:read', 'leads:write'],
    ownScope: ['leads:read', 'leads:write'] });
  /** A new lead of the person's own, by hand. */
  const newLead = async (p: Principal, name?: string, receivedAt?: Date) => (await as(p, (ctx) => captureEnquiry(ctx,
    { phone: mobile(), ...(name === undefined ? {} : { name }), source: 'manual', receivedAt }))).id ?? '';
  const row = async (id: string) => (await owner<Record<string, unknown>>(
    'select stage, lost_reason_id, follow_up_on::text, plan_id, plan_step, value::text, score, email from radcore.leads where id = $1', [id]))[0];
  /** A seeded item's id, by its name. */
  const seeded = async (table: 'lead_lost_reasons' | 'follow_up_plans' | 'quick_replies', column: 'label' | 'name' | 'title', value: string) =>
    (await owner<{ id: string }>(`select id from radcore.${table} where ${column} = $1`, [value]))[0]?.id ?? '';
  const price = () => seeded('lead_lost_reasons', 'label', 'Price');
  const newEnquiry = () => seeded('follow_up_plans', 'name', 'New enquiry');
  const timeline = async (id: string) => (await owner<{ kind: string; stage: string | null; note: string | null }>(
    'select kind, stage, note from radcore.lead_activities where lead_id = $1 order by created_at, kind', [id]));
  const inbox = (p: Principal) => as(p, (ctx) => myNotificationsPage(ctx, { limit: 50, filter: {} })).then((n) => n.items.map((i) => i.text));

  // e2e-2 on dev: GET /leads answered 500 once a lead existed, since the list passed the column's PostgreSQL text
  // ("2026-11-22 05:16:33.76+00") where the contract wants an ISO moment. Through the handler, which checks the answer.
  it('answers GET /leads over the API with each lead’s last enquiry as an ISO moment', async () => {
    const asha = sales(await person());
    const id = await newLead(asha, 'Moment', new Date(`${TODAY}T05:16:33.760Z`));
    const config = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(config, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => asha, routes: crmRoutes }),
      0, '127.0.0.1');
    try {
      const sent = requestFor(listLeads, { limit: 50, filter: {} });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method,
        headers: { origin: config.publicOrigin, 'sec-fetch-site': 'same-origin' } });
      const body = await res.json() as { items?: { id: string; lastEnquiryAt: string }[] };
      expect([res.status, body.items?.find((l) => l.id === id)?.lastEnquiryAt]).toEqual([200, `${TODAY}T05:16:33.760Z`]);
    } finally {
      await server.stop();
    }
  });

  it('lists only the person’s own leads, a page at a time, with each number masked to its last 4 (RC-041)', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const [a1, a2] = [await newLead(sales(ashaId), 'One', new Date(`${TODAY}T05:00:00Z`)), await newLead(sales(ashaId), 'Two')];
    await newLead(sales(raviId), 'Ravi’s');
    const first = await as(sales(ashaId), (ctx) => listLeadsPage(ctx, { limit: 1, filter: {} }));
    const second = await as(sales(ashaId), (ctx) => listLeadsPage(ctx, { limit: 1, filter: {}, after: first.next ?? '' }));
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([a2, a1]);
    expect(second.next).toBeNull();
    // The list carries the mask itself, for every viewer, pii:read included: the contract has no pii() field to
    // unmask, so the handler logs no look (the architect on #262).
    const [{ phone } = { phone: '' }] = await owner<{ phone: string }>('select phone from radcore.leads where id = $1', [a2]);
    const reader: Principal = { kind: 'user', userId: ashaId, permissions: ['leads:read', 'pii:read'], ownScope: ['leads:read'] };
    const seen = await as(reader, (ctx) => listLeadsPage(ctx, { limit: 1, filter: {} }));
    expect([seen.items[0]?.phone, first.items[0]?.phone, piiPlan(listLeads.output)])
      .toEqual([{ masked: `••••••${phone.slice(-4)}` }, { masked: `••••••${phone.slice(-4)}` }, null]);
    expect(await owner('select 1 from radcore.access_log where record_id = $1', [a2])).toEqual([]);
    // Filters: a stage, and follow-ups due by a day. Each new lead is due the day it came.
    await as(sales(ashaId), (ctx) => moveLeadStage(ctx, { id: a1, stage: 'interested' }));
    const ids = async (filter: Parameters<typeof listLeadsPage>[1]['filter']) =>
      (await as(sales(ashaId), (ctx) => listLeadsPage(ctx, { limit: 50, filter }))).items.map((i) => i.id);
    expect(await ids({ stage: 'interested' })).toEqual([a1]);
    expect(await ids({ followUpBy: addDays(TODAY, -1) })).toEqual([]);
    expect(await ids({ owner: 'me', followUpBy: TODAY })).toEqual([a2, a1]);
  });

  it('refuses another person’s lead as if there were none', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const id = await newLead(sales(ashaId));
    await expect(as(sales(raviId), (ctx) => moveLeadStage(ctx, { id, stage: 'contacted' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(sales(raviId), (ctx) => updateLeadDetails(ctx, { id, score: 90 }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('loses a lead only with an active lost reason, ends its follow-ups, and reopens it', async () => {
    const asha = sales(await person());
    const id = await newLead(asha);
    const [reason, planId] = [await price(), await newEnquiry()];
    const off = (await as(SETUP, (ctx) => addLostReason(ctx, { label: `Off ${letters()}` }))).id;
    await as(SETUP, (ctx) => changeLostReason(ctx, { id: off, label: `Off ${letters()}`, active: false }));
    await as(asha, (ctx) => putOnPlan(ctx, { id, planId }));
    for (const lostReasonId of [undefined, randomUUID(), off]) {
      await expect(as(asha, (ctx) => moveLeadStage(ctx, { id, stage: 'lost', ...(lostReasonId === undefined ? {} : { lostReasonId }) })))
        .rejects.toMatchObject({ code: 'unknown_reason' });
    }
    await as(asha, (ctx) => moveLeadStage(ctx, { id, stage: 'lost', lostReasonId: reason, note: 'Went for a cheaper board' }));
    expect(await row(id)).toMatchObject({ stage: 'lost', lost_reason_id: reason, follow_up_on: null, plan_id: null, plan_step: null });
    await expect(as(asha, (ctx) => followUpDone(ctx, { id }))).rejects.toMatchObject({ code: 'wrong_stage' });
    await expect(as(asha, (ctx) => putOnPlan(ctx, { id, planId }))).rejects.toMatchObject({ code: 'wrong_stage' });
    await as(asha, (ctx) => moveLeadStage(ctx, { id, stage: 'interested' }));
    expect(await row(id)).toMatchObject({ stage: 'interested', lost_reason_id: null });
    expect(await timeline(id)).toEqual([{ kind: 'stage', stage: 'lost', note: 'Went for a cheaper board' },
      { kind: 'stage', stage: 'interested', note: null }]);
  });

  it('walks a follow-up plan a step at a time, and a date given wins without spending a step', async () => {
    const asha = sales(await person());
    const id = await newLead(asha);
    const planId = await newEnquiry();
    await expect(as(asha, (ctx) => putOnPlan(ctx, { id, planId: randomUUID() }))).rejects.toMatchObject({ code: 'unknown_plan' });
    expect(await as(asha, (ctx) => putOnPlan(ctx, { id, planId }))).toEqual({ followUpOn: addDays(TODAY, 1) });
    expect(await row(id)).toMatchObject({ stage: 'new', plan_id: planId, plan_step: 2 });
    // Made: a new lead is contacted, and the next step is counted from today.
    expect(await as(asha, (ctx) => followUpDone(ctx, { id, note: 'Called, will visit' }))).toEqual({ followUpOn: addDays(TODAY, 2) });
    expect(await row(id)).toMatchObject({ stage: 'contacted', plan_step: 3 });
    expect(await as(asha, (ctx) => followUpDone(ctx, { id, nextOn: '2033-01-05' }))).toEqual({ followUpOn: '2033-01-05' });
    expect(await row(id)).toMatchObject({ plan_step: 3 });
    await as(asha, (ctx) => followUpDone(ctx, { id }));
    // The last step is set, and the plan is done.
    expect(await as(asha, (ctx) => followUpDone(ctx, { id }))).toEqual({ followUpOn: addDays(TODAY, 7) });
    expect(await row(id)).toMatchObject({ plan_id: null, plan_step: null });
    expect(await as(asha, (ctx) => followUpDone(ctx, { id }))).toEqual({ followUpOn: null });
    expect((await timeline(id)).map((t) => t.note)).toEqual(['Called, will visit', null, null, null, null]);
    // Taking it off a plan keeps its follow-up.
    await as(asha, (ctx) => putOnPlan(ctx, { id, planId }));
    expect(await as(asha, (ctx) => putOnPlan(ctx, { id, planId: null }))).toEqual({ followUpOn: addDays(TODAY, 1) });
    expect(await row(id)).toMatchObject({ follow_up_on: addDays(TODAY, 1), plan_id: null });
  });

  it('gives an active quick reply’s text, keeps it on the timeline and makes a new lead contacted', async () => {
    const asha = sales(await person());
    const id = await newLead(asha, 'Kiran');
    const replyId = await seeded('quick_replies', 'title', 'Thanks for your enquiry');
    await expect(as(asha, (ctx) => quickReplyText(ctx, { id, replyId: randomUUID() }))).rejects.toMatchObject({ code: 'unknown_reply' });
    expect(await as(asha, (ctx) => quickReplyText(ctx, { id, replyId })))
      .toEqual({ text: 'Hi, thanks for your enquiry. When would be a good time to talk?' });
    expect(await row(id)).toMatchObject({ stage: 'contacted' });
    expect(await timeline(id)).toEqual([{ kind: 'quick_reply', stage: null, note: 'Thanks for your enquiry' }]);
    // The lead's page shows its timeline, newest first, with who did it.
    const page = await as(asha, (ctx) => leadById(ctx, { id }));
    expect(page.activities).toEqual([{ kind: 'quick_reply', stage: null, note: 'Thanks for your enquiry', at: expect.any(String) as unknown,
      by: { kind: 'user', id: asha.kind === 'user' ? asha.userId : '', displayName: expect.stringMatching(/^Sales /) as unknown } }]);
  });

  it('keeps the CRM’s lists: a name once, a plan rewritten whole, and an item switched off rather than deleted', async () => {
    const label = `Too far ${letters()}`;
    const id = (await as(SETUP, (ctx) => addLostReason(ctx, { label }))).id;
    await expect(as(SETUP, (ctx) => addLostReason(ctx, { label: ` ${label.toUpperCase()} ` }))).rejects.toMatchObject({ code: 'name_taken' });
    const name = `Hot ${letters()}`;
    const planId = (await as(SETUP, (ctx) => addPlan(ctx, { name, steps: [{ afterDays: 1, note: 'Call' }, { afterDays: 3, note: null }] }))).id;
    await as(SETUP, (ctx) => changePlan(ctx, { id: planId, name, active: true, steps: [{ afterDays: 2, note: null }] }));
    const title = `Brochure ${letters()}`;
    await as(SETUP, (ctx) => addQuickReply(ctx, { title, body: 'Here is our brochure.' }));
    const lists = await as(SETUP, (ctx) => leadLists(ctx));
    expect([lists.lostReasons.find((r) => r.id === id), lists.plans.find((p) => p.id === planId)?.steps,
      lists.quickReplies.find((r) => r.title === title)?.body]).toEqual([{ id, label, active: true },
      [{ step: 1, afterDays: 2, note: null }], 'Here is our brochure.']);
    // A reason a lead names can't be deleted, even by the owner login.
    const asha = sales(await person());
    const lead = await newLead(asha);
    await as(asha, (ctx) => moveLeadStage(ctx, { id: lead, stage: 'lost', lostReasonId: id }));
    await expect(owner('delete from radcore.lead_lost_reasons where id = $1', [id])).rejects.toThrow(/foreign key constraint "leads_lost_reason_id_lead_lost_reasons_id_fk"/);
  });

  it('keeps a deal value, a score and an email, and clears one with null', async () => {
    const asha = sales(await person());
    const id = await newLead(asha);
    await as(asha, (ctx) => updateLeadDetails(ctx, { id, value: moneyString().parse('125000.50'), score: 80, email: 'Kiran@Example.TEST' }));
    expect(await row(id)).toMatchObject({ value: '125000.50', score: 80, email: 'kiran@example.test' });
    await as(asha, (ctx) => updateLeadDetails(ctx, { id, score: null }));
    expect(await row(id)).toMatchObject({ value: '125000.50', score: null });
  });

  it('tells a due follow-up’s owner once, by the lead’s last 4, and again only for a new date', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const asha = sales(ashaId);
    const [due, lost] = [await newLead(asha), await newLead(asha)];
    const later = await newLead(asha);
    const lostReasonId = await price();
    await as(asha, (ctx) => moveLeadStage(ctx, { id: lost, stage: 'lost', lostReasonId }));
    await owner("update radcore.leads set follow_up_on = '2020-01-06' where id = any($1)", [[due, lost]]);
    await owner("update radcore.leads set follow_up_on = $2 where id = $1", [later, addDays(TODAY, 1)]);
    // Another's lead, unowned now, tells nobody.
    const free = await newLead(sales(raviId));
    await owner("update radcore.leads set owner = null, follow_up_on = '2020-01-06' where id = $1", [free]);
    const [phone] = await owner<{ phone: string }>('select phone from radcore.leads where id = $1', [due]);
    const told = `Follow up ••••••${phone?.phone.slice(-4) ?? ''}`;
    await as(WATCH, (ctx) => tellFollowUpsDue(ctx));
    await as(WATCH, (ctx) => tellFollowUpsDue(ctx));
    expect(await inbox(asha)).toEqual([told]);
    await owner("update radcore.leads set follow_up_on = '2020-01-07' where id = $1", [due]);
    await as(WATCH, (ctx) => tellFollowUpsDue(ctx));
    expect(await inbox(asha)).toEqual([told, told]);
  });

  /** D-11: a salesperson who also sees, and takes, the leads no one owns. */
  const taker = (userId: string): Principal => ({ kind: 'user', userId, permissions: ['leads:read', 'leads:unassigned', 'leads:write'],
    ownScope: ['leads:read', 'leads:write'] });
  /** A manager: every lead. */
  const manager = (userId: string): Principal => ({ kind: 'user', userId, permissions: ['leads:read', 'leads:write'] });
  /** A lead from the website form: no one owns it. */
  const unowned = async () => (await as({ kind: 'system', name: 'test-form', permissions: ['leads:read', 'leads:write'] },
    (ctx) => captureEnquiry(ctx, { phone: mobile(), source: 'form' }))).id ?? '';

  it('lists the person’s own and the unowned leads with leads:unassigned, never a colleague’s, and only their own without it (D-11)', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const mine = await newLead(sales(ashaId));
    const ravis = await newLead(sales(raviId));
    const free = await unowned();
    const ids = async (p: Principal) => (await as(p, (ctx) => listLeadsPage(ctx, { limit: 200, filter: {} }))).items.map((i) => i.id);
    const withKey = await ids(taker(ashaId));
    expect([withKey.includes(mine), withKey.includes(free), withKey.includes(ravis)]).toEqual([true, true, false]);
    expect(await ids(sales(ashaId))).toEqual([mine]);
    // One lead the same way: opening it doesn't take it.
    expect((await as(taker(ashaId), (ctx) => leadById(ctx, { id: free }))).owner).toBeNull();
    await expect(as(sales(ashaId), (ctx) => leadById(ctx, { id: free }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(sales(ashaId), (ctx) => moveLeadStage(ctx, { id: free, stage: 'contacted' }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('gives an unowned lead to the first who acts on it, and refuses the second with lead_taken', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const id = await unowned();
    let taken!: () => void;
    let release!: () => void;
    const tookIt = new Promise<void>((r) => { taken = r; });
    const gate = new Promise<void>((r) => { release = r; });
    // Asha takes it and holds her transaction open while Ravi acts.
    const asha = as(taker(ashaId), async (ctx) => {
      await moveLeadStage(ctx, { id, stage: 'contacted' });
      taken();
      await gate;
    });
    await tookIt;
    const ravi = as(taker(raviId), (ctx) => followUpDone(ctx, { id }));
    // Ravi saw it unowned and now waits on Asha's row lock: a lock request for the very transaction that holds this
    // lead's row (its xmax, Asha's uncommitted claim), so another test file's lock wait can't end this early, which let
    // Ravi read Asha's committed claim (not_found). Bounded, as #252's waits are.
    await vi.waitFor(async () => {
      const [w] = await owner<{ n: number }>(`select count(*)::int as n from pg_locks where not granted and locktype = 'transactionid'
        and transactionid = (select xmax from radcore.leads where id = $1)`, [id]);
      expect(w?.n).toBeGreaterThanOrEqual(1);
    }, { timeout: 15_000, interval: 50 });
    release();
    await asha;
    await expect(ravi).rejects.toMatchObject({ code: 'lead_taken' });
    expect(await owner('select owner, stage from radcore.leads where id = $1', [id])).toEqual([{ owner: `user:${ashaId}`, stage: 'contacted' }]);
  });

  it('takes an unowned lead on a repeat enquiry only for a holder of leads:unassigned', async () => {
    const [ashaId, raviId] = [await person(), await person()];
    const id = await unowned();
    const [{ phone } = { phone: '' }] = await owner<{ phone: string }>('select phone from radcore.leads where id = $1', [id]);
    expect(await as(sales(raviId), (ctx) => captureEnquiry(ctx, { phone, source: 'walk_in' }))).toEqual({ repeat: true });
    expect(await as(taker(ashaId), (ctx) => captureEnquiry(ctx, { phone, source: 'walk_in' }))).toEqual({ id, repeat: true });
    expect(await owner('select owner from radcore.leads where id = $1', [id])).toEqual([{ owner: `user:${ashaId}` }]);
  });

  it('hands a lead on only at all scope, to a person who exists, or back to no one', async () => {
    const [ashaId, raviId, bossId] = [await person(), await person(), await person()];
    const id = await newLead(sales(ashaId));
    // Only an active person can be handed a lead: Ravi signs in (a stand-in hash), Boss stays as invited.
    await owner("update radcore.users set status = 'active', password_hash = 'test' where id = $1", [raviId]);
    await expect(as(taker(ashaId), (ctx) => assignLeadOwner(ctx, { id, owner: raviId }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(taker(ashaId), (ctx) => assignLeadOwner(ctx, { id, owner: null }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(manager(bossId), (ctx) => assignLeadOwner(ctx, { id, owner: randomUUID() }))).rejects.toMatchObject({ code: 'unknown_person' });
    // Someone whose role doesn't see leads, or whose account is switched off, can't be handed one.
    const [clerk] = await owner<{ id: string }>("insert into radcore.users (email, display_name, role, status, password_hash) values ($1, 'Clerk', 'accounts', 'active', 'test') returning id",
      [`${letters()}@example.test`]);
    const [gone] = await owner<{ id: string }>("insert into radcore.users (email, display_name, role, status, password_hash) values ($1, 'Gone', 'sales', 'disabled', 'test') returning id",
      [`${letters()}@example.test`]);
    for (const to of [clerk?.id ?? '', gone?.id ?? '']) {
      await expect(as(manager(bossId), (ctx) => assignLeadOwner(ctx, { id, owner: to }))).rejects.toMatchObject({ code: 'owner_cannot_see_leads' });
    }
    await as(manager(bossId), (ctx) => assignLeadOwner(ctx, { id, owner: raviId }));
    expect(await owner('select owner from radcore.leads where id = $1', [id])).toEqual([{ owner: `user:${raviId}` }]);
    await as(manager(bossId), (ctx) => assignLeadOwner(ctx, { id, owner: null }));
    expect(await owner('select owner from radcore.leads where id = $1', [id])).toEqual([{ owner: null }]);
    // A manager's note on an unowned lead is triage and doesn't take it; a salesperson's note does (the architect).
    await as(manager(bossId), (ctx) => updateLeadDetails(ctx, { id, notes: 'Wants the blue one' }));
    expect(await owner('select owner from radcore.leads where id = $1', [id])).toEqual([{ owner: null }]);
    await as(taker(raviId), (ctx) => updateLeadDetails(ctx, { id, notes: 'Calling today' }));
    expect(await owner('select owner, notes from radcore.leads where id = $1', [id])).toEqual([{ owner: `user:${raviId}`, notes: 'Calling today' }]);
  });
});
