// RAD-38 (RC-037, ADR-001 §8b): maker-checker over real HTTP on PostgreSQL 16. A module's approval (here a fixture
// "order" in a schema of this file's own) is requested by its maker and decided by a second person: never the maker,
// never an account made after the request, only the exact version the approver saw, only while pending, only once,
// and only within the approver's scope. Here in tools/ because server code may not call fetch (ADR-002 L8).
import { randomBytes, randomUUID } from 'node:crypto';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { defineApproval, loadConfig, requestApproval, type ApprovalSpec, type Principal } from '@radcore/lib-platform';
import { runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { eq } from 'drizzle-orm';
import { boolean, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import { moduleTx } from '../packages/db/src/module-tx.ts';
import { createDatabase } from '../packages/lib-platform/src/db/client.ts';

// The owner login: this file makes a schema and a table of its own (RAD-24).
const url = process.env['TEST_DATABASE_OWNER_URL'];
const tag = randomBytes(4).toString('hex');
const fixture = pgSchema(`approvals_${tag}`);
const orders = fixture.table('orders', { id: uuid().primaryKey().defaultRandom(), amount: text().notNull(),
  status: text().notNull().default('draft'), hidden: boolean().notNull().default(false) });
const ordersTx = moduleTx({ orders });
const KIND = `test-order-${tag}`;
const PERM = 'orders:approve';
const contracts = approvalContracts(KIND, PERM);
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const person = (userId: string, permissions = [PERM]): Principal => ({ kind: 'user', userId, permissions });

// The module's part: the figures the approver sees, and what each decision does. `hidden` stands in for a record
// outside the approver's scope, which RAD-35's ctx.can will decide.
const approvedRuns = vi.fn<(id: string) => void>();
const spec: ApprovalSpec<{ amount: string }> = {
  kind: KIND,
  async version(ctx, id, { forUpdate }) {
    const query = ordersTx(ctx).select({ amount: orders.amount, hidden: orders.hidden }).from(orders).where(eq(orders.id, id));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row === undefined || row.hidden ? null : { amount: row.amount };
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
  const db = createDatabase(pool, { orders });
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
    await pool.query(`create schema ${fixture.schemaName}`);
    await pool.query(`create table ${fixture.schemaName}.orders (id uuid primary key default gen_random_uuid(),
      amount text not null, status text not null default 'draft', hidden boolean not null default false)`);
    people.maker = await newUser();
    people.approver = await newUser();
    people.second = await newUser();
  });
  afterAll(async () => {
    await pool.query(`drop schema ${fixture.schemaName} cascade`);
    await pool.end();
  });

  // An order, sent for approval by its maker; every test makes its own.
  const requested = async (amount = '1500.00') => {
    const [order] = (await pool.query<{ id: string }>(`insert into ${fixture.schemaName}.orders (amount) values ($1) returning id`,
      [amount])).rows;
    const orderId = order?.id ?? '';
    const request = await runInTransaction(db, WRITE, person(people.maker, []), randomUUID(), (ctx) => requestApproval(ctx, spec, orderId));
    return { orderId, ...request };
  };
  const orderStatus = async (id: string) => (await pool.query<{ status: string }>(
    `select status from ${fixture.schemaName}.orders where id = $1`, [id])).rows[0]?.status;
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
        version: { amount: '2500.00' }, versionHash, currentHash: versionHash, changed: false })]);
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
      await pool.query(`update ${fixture.schemaName}.orders set amount = '9000.00' where id = $1`, [orderId]);
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
    const again = await runInTransaction(db, WRITE, person(people.maker, []), randomUUID(), (ctx) => requestApproval(ctx, spec, first.orderId));
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
    await pool.query(`update ${fixture.schemaName}.orders set hidden = true where id = $1`, [orderId]);
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
});
