// RAD-38 (RC-037, ADR-001 §8b): maker-checker over real HTTP on PostgreSQL 16. A module's approval (here a fixture
// "order" with its lines, audited tables of this file's own) is requested by its maker and decided by a second person:
// never the requester, never anyone who changed the order or its lines since its last approval (read from the audit
// log), never an account made after the request, only the exact version the approver saw, only while pending, only
// once, and only within the approver's scope. Here in tools/ because server code may not call fetch (ADR-002 L8).
import { randomBytes, randomUUID } from 'node:crypto';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { defineApproval, loadConfig, requestApproval, type ApprovalSpec, type Principal } from '@radcore/lib-platform';
import { runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { eq } from 'drizzle-orm';
import { boolean, text, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import { radcore } from '../packages/db/src/columns.ts';
import { moduleTx } from '../packages/db/src/module-tx.ts';
import { createDatabase } from '../packages/lib-platform/src/db/client.ts';

// The owner login: this file makes two tables of its own in radcore, audited like a module's (RAD-24, RAD-30): the
// audit trigger works only there, and the maker rule reads what it writes.
const url = process.env['TEST_DATABASE_OWNER_URL'];
const tag = randomBytes(4).toString('hex');
const [ORDERS, LINES] = [`t_orders_${tag}`, `t_order_lines_${tag}`];
const orders = radcore.table(ORDERS, { id: uuid().primaryKey().defaultRandom(), amount: text().notNull(),
  status: text().notNull().default('draft'), hidden: boolean().notNull().default(false) });
const lines = radcore.table(LINES, { id: uuid().primaryKey().defaultRandom(), orderId: uuid().notNull(), qty: text().notNull() });
const ordersTx = moduleTx({ orders, lines });
const STAMPS = `created_at timestamptz not null default now(),
  created_by text not null default nullif(current_setting('app.principal', true), ''),
  updated_at timestamptz not null default now(),
  updated_by text not null default nullif(current_setting('app.principal', true), '')`;
const KIND = `test-order-${tag}`;
const PERM = 'orders:approve';
const contracts = approvalContracts(KIND, PERM);
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const person = (userId: string, permissions = [PERM]): Principal => ({ kind: 'user', userId, permissions });

// The module's part: the figures the approver sees (the amount and every line), and what each decision does. `hidden`
// stands in for a record outside the approver's scope, which RAD-35's ctx.can will decide.
const approvedRuns = vi.fn<(id: string) => void>();
const spec: ApprovalSpec<{ amount: string; lines: { id: string; qty: string }[] }> = {
  kind: KIND,
  table: ORDERS,
  parts: [LINES],
  async version(ctx, id, { forUpdate }) {
    const query = ordersTx(ctx).select({ amount: orders.amount, hidden: orders.hidden }).from(orders).where(eq(orders.id, id));
    const [row] = forUpdate ? await query.for('update') : await query;
    if (row === undefined || row.hidden) return null;
    const its = await ordersTx(ctx).select({ id: lines.id, qty: lines.qty }).from(lines).where(eq(lines.orderId, id)).orderBy(lines.id);
    return { amount: row.amount, lines: its };
  },
  async approved(ctx, id) {
    approvedRuns(id);
    await ordersTx(ctx).update(orders).set({ status: 'approved' }).where(eq(orders.id, id));
  },
  async rejected(ctx, id) {
    await ordersTx(ctx).update(orders).set({ status: 'rejected' }).where(eq(orders.id, id));
  },
};

describe.skipIf(!url)('maker-checker', () => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  const db = createDatabase(pool, { orders, lines });
  const people: { maker: string; approver: string; second: string } = { maker: '', approver: '', second: '' };

  // A person, made now, in a transaction of their own: created_at is when it commits.
  const newUser = async (): Promise<string> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.principal', 'system:test', true)");
      const { rows } = await client.query<{ id: string }>('insert into radcore.users (email, display_name) values ($1, $2) returning id',
        [`approver-${randomUUID()}@example.test`, 'Test person']);
      await client.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    // One transaction, so the schema guards (tools/schema.test.ts) never see the tables unattached.
    await pool.query(`begin;
      create table radcore.${ORDERS} (id uuid primary key default gen_random_uuid(), amount text not null,
        status text not null default 'draft', hidden boolean not null default false, ${STAMPS});
      create table radcore.${LINES} (id uuid primary key default gen_random_uuid(),
        order_id uuid not null references radcore.${ORDERS} (id), qty text not null, ${STAMPS});
      create index on radcore.${LINES} (order_id);
      select radcore.audit_attach('${ORDERS}', keep => array['amount', 'status', 'hidden']);
      select radcore.audit_attach('${LINES}', keep => array['order_id', 'qty'], owner => 'order_id');
      commit`);
    people.maker = await newUser();
    people.approver = await newUser();
    people.second = await newUser();
  });
  afterAll(async () => {
    await pool.query(`drop table radcore.${LINES}, radcore.${ORDERS}`);
    await pool.end();
  });

  // A change as `who`, in a transaction of its own, as a module's service would make it: the audit log records who.
  const as = (who: Principal, change: (tx: ReturnType<typeof ordersTx>) => Promise<unknown>) =>
    runInTransaction(db, WRITE, who, randomUUID(), async (ctx) => { await change(ordersTx(ctx)); });
  const job: Principal = { kind: 'system', name: 'nightly-prices', permissions: [] };
  // The maker sends it (again): a new request, which supersedes the pending one.
  const sendAgain = (orderId: string) =>
    runInTransaction(db, WRITE, person(people.maker, []), randomUUID(), (ctx) => requestApproval(ctx, spec, orderId));
  // An order with one line, made and sent for approval by its maker; every test makes its own.
  const requested = async (amount = '1500.00') => {
    const ids = { orderId: randomUUID(), lineId: randomUUID() };
    await as(person(people.maker, []), async (tx) => {
      await tx.insert(orders).values({ id: ids.orderId, amount });
      await tx.insert(lines).values({ id: ids.lineId, orderId: ids.orderId, qty: '2' });
    });
    return { ...ids, ...await sendAgain(ids.orderId) };
  };
  const orderStatus = async (id: string) => (await pool.query<{ status: string }>(
    `select status from radcore.${ORDERS} where id = $1`, [id])).rows[0]?.status;
  const approval = async (id: string) => (await pool.query<{ status: string; decided_by: string | null; reason: string | null }>(
    'select status, decided_by, reason from radcore.approvals where id = $1', [id])).rows[0];

  async function serve(principal: Principal, fn: (call: (method: string, path: string, body?: unknown) => Promise<Response>) => Promise<void>) {
    const app = createApp(config(), logger(), { db, authenticate: async () => principal, routes: defineApproval(contracts, spec) });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn((method, path, body) => fetch(`http://127.0.0.1:${server.port}${path}`, {
        method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'idempotency-key': randomUUID() },
      }));
    } finally {
      await server.stop();
    }
  }
  const decide = (call: (m: string, p: string, b?: unknown) => Promise<Response>, id: string, body: object) =>
    call('POST', `/approvals/${KIND}/${id}/decision`, body);
  const codeOf = async (res: Response) => [res.status, (await res.json() as { code?: string; status?: string }).code ?? ''];

  it('lists and shows a pending request with the version the approver sees and its hash', async () => {
    const { orderId, id, versionHash } = await requested('2500.00');
    await serve(person(people.approver), async (call) => {
      const list = await (await call('GET', `/approvals/${KIND}?input=${encodeURIComponent(JSON.stringify({ filter: {}, limit: 100 }))}`)).json() as
        { items: { id: string; recordId: string; requestedBy: string }[] };
      expect(list.items).toContainEqual(expect.objectContaining({ id, recordId: orderId, requestedBy: `user:${people.maker}` }));
      const shown = await call('GET', `/approvals/${KIND}/${id}`);
      expect([shown.status, await shown.json()]).toEqual([200, expect.objectContaining({ id, status: 'pending',
        version: { amount: '2500.00', lines: [{ id: expect.any(String), qty: '2' }] }, versionHash, currentHash: versionHash,
        changed: false })]);
    });
  });

  it('never lets the maker decide their own request, either way (RC-037)', async () => {
    const { id, versionHash, orderId } = await requested();
    await serve(person(people.maker), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([422, 'own_request']);
      expect(await codeOf(await decide(call, id, { decision: 'reject', reason: 'never mind' }))).toEqual([422, 'own_request']);
    });
    expect([await orderStatus(orderId), (await approval(id))?.status]).toEqual(['draft', 'pending']);
  });

  it('refuses an approver whose account was made after the request', async () => {
    const { id, versionHash } = await requested();
    const fresh = await newUser();
    await serve(person(fresh), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([422, 'approver_too_new']);
    });
  });

  it('approves only the exact version requested and seen: a changed record or another screen is version_changed', async () => {
    const { id, versionHash, orderId } = await requested('1000.00');
    await serve(person(people.approver), async (call) => {
      // The screen showed another version.
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash: 'f'.repeat(64) }))).toEqual([422, 'version_changed']);
      // The record changed after the request.
      await as(person(people.maker, []), (tx) => tx.update(orders).set({ amount: '9000.00' }).where(eq(orders.id, orderId)));
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([422, 'version_changed']);
      expect(await (await call('GET', `/approvals/${KIND}/${id}`)).json()).toMatchObject({ changed: true, version: { amount: '9000.00' } });
    });
    expect([await orderStatus(orderId), (await approval(id))?.status]).toEqual(['draft', 'pending']);
  });

  it('approves once: the module applies it, the row names the approver, and a second decision is not_pending', async () => {
    const { id, versionHash, orderId } = await requested();
    await serve(person(people.approver), async (call) => {
      const ok = await decide(call, id, { decision: 'approve', versionHash });
      expect([ok.status, await ok.json()]).toEqual([200, { status: 'approved' }]);
      expect(await codeOf(await decide(call, id, { decision: 'reject', reason: 'too late' }))).toEqual([422, 'not_pending']);
    });
    expect([await orderStatus(orderId), await approval(id)]).toEqual(['approved',
      { status: 'approved', decided_by: `user:${people.approver}`, reason: null }]);
  });

  it('rejects with a reason only, and the module sends it back', async () => {
    const { id, orderId } = await requested();
    await serve(person(people.approver), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'reject' }))).toEqual([400, 'invalid_input']);
      expect(await codeOf(await decide(call, id, { decision: 'approve' }))).toEqual([400, 'invalid_input']);
      expect((await decide(call, id, { decision: 'reject', reason: 'Wrong supplier' })).status).toBe(200);
    });
    expect([await orderStatus(orderId), await approval(id)]).toEqual(['rejected',
      { status: 'rejected', decided_by: `user:${people.approver}`, reason: 'Wrong supplier' }]);
  });

  it('supersedes a pending request when the record is sent again: the old one is not_pending', async () => {
    const first = await requested();
    const again = await sendAgain(first.orderId);
    await serve(person(people.approver), async (call) => {
      expect(await codeOf(await decide(call, first.id, { decision: 'approve', versionHash: first.versionHash }))).toEqual([422, 'not_pending']);
      expect((await decide(call, again.id, { decision: 'approve', versionHash: again.versionHash })).status).toBe(200);
    });
    expect((await approval(first.id))?.status).toBe('superseded');
  });

  it('takes two approvers at once one after the other: one approves, the other finds it decided', async () => {
    const { id, versionHash, orderId } = await requested();
    const results = await Promise.all([people.approver, people.second].map((who) => new Promise<unknown[]>((done, fail) => {
      serve(person(who), async (call) => done(await codeOf(await decide(call, id, { decision: 'approve', versionHash })))).catch(fail);
    })));
    expect(results.map(([status]) => status).sort()).toEqual([200, 422]);
    expect(results).toContainEqual([422, 'not_pending']);
    expect(approvedRuns.mock.calls.filter(([o]) => o === orderId)).toHaveLength(1);
  });

  it('hides a record outside the approver\'s scope: not listed, not shown, not decided (404)', async () => {
    const { id, versionHash, orderId } = await requested('700.00');
    // Out of the approver's scope from here on (the maker could see it).
    await as(job, (tx) => tx.update(orders).set({ hidden: true }).where(eq(orders.id, orderId)));
    await serve(person(people.approver), async (call) => {
      const list = await (await call('GET', `/approvals/${KIND}?input=${encodeURIComponent(JSON.stringify({ filter: {}, limit: 100 }))}`)).json() as
        { items: { id: string }[] };
      expect(list.items.map((i) => i.id)).not.toContain(id);
      expect(await codeOf(await call('GET', `/approvals/${KIND}/${id}`))).toEqual([404, 'not_found']);
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([404, 'not_found']);
    });
  });

  it('lets only a person holding the permission decide: not a system principal, not someone without it', async () => {
    const { id, versionHash } = await requested();
    await serve({ kind: 'system', name: 'nightly', permissions: [PERM] }, async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([403, 'forbidden']);
    });
    await serve(person(people.approver, ['orders:read']), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([403, 'forbidden']);
    });
    expect((await approval(id))?.status).toBe('pending');
  });

  // The maker rule (the architect on RAD-38): whoever changed what is being approved since its last approval can't
  // approve it, however the request was sent and whoever changed it after them.

  it('refuses an approver who changed only a line since the last approval (own_request)', async () => {
    const { orderId, lineId } = await requested();
    await as(person(people.approver), (tx) => tx.update(lines).set({ qty: '20' }).where(eq(lines.id, lineId)));
    const { id, versionHash } = await sendAgain(orderId);
    await serve(person(people.approver), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([422, 'own_request']);
    });
    await serve(person(people.second), async (call) => {
      expect((await decide(call, id, { decision: 'approve', versionHash })).status).toBe(200);
    });
  });

  it('still refuses an approver whose change someone else changed again afterwards', async () => {
    const { orderId } = await requested();
    await as(person(people.approver), (tx) => tx.update(orders).set({ amount: '1600.00' }).where(eq(orders.id, orderId)));
    await as(person(people.second), (tx) => tx.update(orders).set({ amount: '1650.00' }).where(eq(orders.id, orderId)));
    const { id, versionHash } = await sendAgain(orderId);
    await serve(person(people.approver), async (call) => {
      expect(await codeOf(await decide(call, id, { decision: 'approve', versionHash }))).toEqual([422, 'own_request']);
    });
  });

  it("counts only changes since the record's last approval", async () => {
    const { orderId } = await requested();
    await as(person(people.approver), (tx) => tx.update(orders).set({ amount: '1700.00' }).where(eq(orders.id, orderId)));
    const first = await sendAgain(orderId);
    await serve(person(people.second), async (call) => {
      expect((await decide(call, first.id, { decision: 'approve', versionHash: first.versionHash })).status).toBe(200);
    });
    // After that approval only the maker changes it, so the approver's earlier change no longer counts.
    await as(person(people.maker, []), (tx) => tx.update(orders).set({ amount: '1800.00' }).where(eq(orders.id, orderId)));
    const next = await sendAgain(orderId);
    await serve(person(people.approver), async (call) => {
      expect((await decide(call, next.id, { decision: 'approve', versionHash: next.versionHash })).status).toBe(200);
    });
  });

  it("doesn't count a job's change: a job is no maker", async () => {
    const { orderId } = await requested();
    await as(job, (tx) => tx.update(orders).set({ amount: '1550.00' }).where(eq(orders.id, orderId)));
    const { id, versionHash } = await sendAgain(orderId);
    await serve(person(people.approver), async (call) => {
      expect((await decide(call, id, { decision: 'approve', versionHash })).status).toBe(200);
    });
    expect((await pool.query("select count(*)::int as n from radcore.audit_log where table_name = $1 and record_id = $2 "
      + "and created_by = 'system:nightly-prices'", [ORDERS, orderId])).rows[0]).toEqual({ n: 1 });
  });

  it("doesn't make the approver a maker of the next approval by what approving wrote", async () => {
    const first = await requested();
    await serve(person(people.approver), async (call) => {
      expect((await decide(call, first.id, { decision: 'approve', versionHash: first.versionHash })).status).toBe(200);
    });
    // approved() set the order's status as the approver; only the maker changes it after that.
    await as(person(people.maker, []), (tx) => tx.update(orders).set({ amount: '1900.00' }).where(eq(orders.id, first.orderId)));
    const next = await sendAgain(first.orderId);
    await serve(person(people.approver), async (call) => {
      expect((await decide(call, next.id, { decision: 'approve', versionHash: next.versionHash })).status).toBe(200);
    });
  });

  it("writes the record's id on its lines' audit rows (audit_attach owner =>)", async () => {
    const { orderId, lineId } = await requested();
    expect((await pool.query('select owner_id from radcore.audit_log where table_name = $1 and record_id = $2', [LINES, lineId])).rows)
      .toEqual([{ owner_id: orderId }]);
  });
});
