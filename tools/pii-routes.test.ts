// RAD-40 (M1-22, RC-040, ADR-001 §7a, ADR-005 §7c) over real HTTP on PostgreSQL 16: the generic handler masks pii()
// fields on the declared output for a principal without pii:read (pay: pay:read), in a lookup, a list and a record
// reached through another; logs each record shown unmasked against its piiRecord's table, a read's before it answers
// and a write's with its work; keeps only the masked answer for saved-once, and a replay logs nothing new; refuses a
// write that sends a mask back; and refuses to mount a pii() field outside a piiRecord. Here in tools/ because server
// code may not call fetch (ADR-002 L8).
import { randomUUID } from 'node:crypto';
import { defineContract, idString, listOf, pii, piiRecord } from '@radcore/lib-common';
import { defineRoute, loadConfig, type Principal } from '@radcore/lib-platform';
import { createDatabase } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });

// Two of radcore's tables stand in for a module's own (people, their managers): a look names a real table.
const person = piiRecord('users', z.object({ id: idString(), name: z.string(), phone: pii(z.string(), 'last4'),
  salary: pii(z.string(), 'pay'), manager: piiRecord('files', z.object({ id: idString(), phone: pii(z.string(), 'last4') })).nullable() }));
type Person = z.output<typeof person>;
const getPerson = defineContract({ method: 'POST', path: '/t/people/one', auth: 'session', perm: 'people:read', tx: read,
  input: z.object({ id: idString(), manager: idString().optional() }), output: person });
const listPeople = defineContract({ method: 'POST', path: '/t/people/list', auth: 'session', perm: 'people:read', tx: read,
  input: z.object({ ids: z.array(idString()) }), output: listOf(person) });
const savePerson = defineContract({ method: 'POST', path: '/t/people/save', auth: 'session', perm: 'people:read', tx: write,
  input: z.object({ id: idString(), name: z.string(), phone: z.string().optional(),
    notes: z.array(z.object({ text: z.string() })).optional() }), output: person });

const someone = (id: string): Person => ({ id, name: 'Asha', phone: '+919876543210', salary: '125000.00', manager: null });
const as = (permissions: string[]): Principal => ({ kind: 'user', userId: randomUUID(), permissions: ['people:read', ...permissions] });
const MASKED_PHONE = { masked: '••••••3210' };
const MASKED_PAY = { masked: '••••••' };

describe.skipIf(!url || !superUrl)('pii() routes', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const saved = vi.fn<(input: unknown) => void>();
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  const routes = [
    defineRoute(getPerson, async (_ctx, { id, manager }) => ({ ...someone(id),
      manager: manager === undefined ? null : { id: manager, phone: '+911234567890' } })),
    defineRoute(listPeople, async (_ctx, { ids }) => ({ items: ids.map(someone), next: null })),
    defineRoute(savePerson, async (_ctx, input) => {
      saved(input);
      return someone(input.id);
    }),
  ];
  async function serve(principal: Principal, fn: (post: (path: string, body: object, key?: string) => Promise<Response>) => Promise<void>,
    site: string | null = 'same-origin') {
    const app = createApp(config(), logger(), { db, authenticate: async () => principal, routes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn((path, body, key) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...(site === null ? {} : { 'sec-fetch-site': site }),
          ...(key === undefined ? {} : { 'idempotency-key': key }) } }));
    } finally {
      await server.stop();
    }
  }
  const looksAt = async (ids: string[]) => (await admin.query<{ record_table: string; record_id: string; created_by: string }>(
    'select record_table, record_id, created_by from radcore.access_log where record_id = any($1) order by record_id', [ids])).rows;

  it('masks personal data without pii:read and pay without pay:read, a related record included, and logs no look', async () => {
    const [id, manager] = [randomUUID(), randomUUID()];
    await serve(as([]), async (post) => {
      const body = await (await post('/t/people/one', { id, manager })).json() as Person;
      expect(body).toEqual({ ...someone(id), phone: MASKED_PHONE, salary: MASKED_PAY,
        manager: { id: manager, phone: { masked: '••••••7890' } } });
    });
    expect(await looksAt([id, manager])).toEqual([]);
  });

  it('shows pii:read personal data but still masks pay, and logs each record against its own table before answering', async () => {
    const [id, manager] = [randomUUID(), randomUUID()];
    const reader = as(['pii:read']);
    const by = reader.kind === 'user' ? `user:${reader.userId}` : '';
    await serve(reader, async (post) => {
      const body = await (await post('/t/people/one', { id, manager })).json() as Person;
      expect([body.phone, body.salary]).toEqual(['+919876543210', MASKED_PAY]);
      // The looks are in the log by the time the answer arrives.
      expect((await looksAt([id, manager])).map((r) => [r.record_id, r.record_table, r.created_by]).sort())
        .toEqual([[id, 'users', by], [manager, 'files', by]].sort());
    });
  });

  it('masks everything, and logs nothing, for a request that is not same-origin or typed (ADR-005 §7c)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const all = as(['pii:read', 'pay:read']);
    for (const [site, id] of [['cross-site', ids[0]], ['same-site', ids[1]], [null, ids[2]]] as const) {
      await serve(all, async (post) => {
        const body = await (await post('/t/people/one', { id })).json() as Person;
        expect([body.phone, body.salary]).toEqual([MASKED_PHONE, MASKED_PAY]);
      }, site);
    }
    expect(await looksAt(ids)).toEqual([]);
    const typed = randomUUID();
    await serve(all, async (post) => {
      expect(((await (await post('/t/people/one', { id: typed })).json()) as Person).phone).toBe('+919876543210');
    }, 'none');
    expect((await looksAt([typed])).length).toBe(1);
  });

  it('logs every look against a real table, as public_links checks its own (the architect on #156)', async () => {
    const [id, manager] = [randomUUID(), randomUUID()];
    await serve(as(['pii:read']), async (post) => {
      expect((await post('/t/people/one', { id, manager })).status).toBe(200);
    });
    expect(await looksAt([id, manager])).toHaveLength(2);
    const { rows } = await admin.query("select distinct record_table from radcore.access_log where to_regclass('radcore.' || record_table) is null");
    expect(rows).toEqual([]);
  });

  it('logs one look per record a list page shows unmasked', async () => {
    const ids = [randomUUID(), randomUUID()].sort();
    await serve(as(['pay:read']), async (post) => {
      const page = await (await post('/t/people/list', { ids })).json() as { items: Person[] };
      expect(page.items.map((p) => [p.phone, p.salary])).toEqual([[MASKED_PHONE, '125000.00'], [MASKED_PHONE, '125000.00']]);
    });
    expect((await looksAt(ids)).map((r) => r.record_id)).toEqual(ids);
  });

  it('keeps only the masked answer for saved-once, and replays it', async () => {
    const id = randomUUID();
    const key = randomUUID();
    await serve(as([]), async (post) => {
      const first = await (await post('/t/people/save', { id, name: 'Asha' }, key)).json() as Person;
      const again = await (await post('/t/people/save', { id, name: 'Asha' }, key)).json() as Person;
      expect([first.phone, again]).toEqual([MASKED_PHONE, first]);
    });
    const [row] = (await admin.query<{ answer: unknown }>('select answer from radcore.saved_once where key = $1', [key])).rows;
    expect(JSON.stringify(row?.answer)).not.toContain('9876543210');
  });

  it("logs a write's look with its work, and a replay logs nothing new", async () => {
    const id = randomUUID();
    const key = randomUUID();
    await serve(as(['pii:read']), async (post) => {
      expect((await post('/t/people/save', { id, name: 'Asha' }, key)).status).toBe(200);
      expect((await post('/t/people/save', { id, name: 'Asha' }, key)).status).toBe(200);
    });
    expect((await looksAt([id])).map((r) => r.record_table)).toEqual(['users']);
  });

  it('refuses a write that sends a mask back, at any depth, before the service runs, and saves bulleted text', async () => {
    saved.mockClear();
    await serve(as([]), async (post) => {
      for (const [body, path] of [[{ phone: '••••••3210' }, ['phone']], [{ notes: [{ text: 'ok' }, { text: '••••••' }] }, ['notes', 1, 'text']]] as const) {
        const res = await post('/t/people/save', { id: randomUUID(), name: 'Asha', ...body }, randomUUID());
        const err = await res.json() as { code: string; issues: { path: unknown[]; code: string }[] };
        expect([res.status, err.code, err.issues.map((i) => [i.path, i.code])]).toEqual([400, 'invalid_input', [[path, 'masked_value']]]);
      }
      expect(saved).not.toHaveBeenCalled();
      const bulleted = await post('/t/people/save', { id: randomUUID(), name: 'Asha', notes: [{ text: '• first' }] }, randomUUID());
      expect(bulleted.status).toBe(200);
    });
  });

  it('refuses to mount a contract with a pii() field outside a piiRecord', () => {
    const stray = defineContract({ method: 'POST', path: '/t/people/stray', auth: 'session', perm: 'people:read', tx: read,
      input: z.object({}), output: z.object({ id: idString(), phone: pii() }) });
    expect(() => createApp(config(), logger(), { db, authenticate: async () => null,
      routes: [defineRoute(stray, async () => ({ id: randomUUID(), phone: '+919876543210' }))] }))
      .toThrow(/POST \/t\/people\/stray: a pii\(\) field sits outside any piiRecord/);
  });
});
