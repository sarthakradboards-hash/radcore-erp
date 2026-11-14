// RAD-40 (M1-22, RC-040, ADR-001 §7a, ADR-005 §7c) over real HTTP on PostgreSQL 16: the generic handler masks pii()
// fields on the declared output for a principal without pii:read (pay: pay:read), in a lookup, a list and a value
// reached through a relation; logs each record shown unmasked to access_log before answering; keeps only the masked
// answer for saved-once; and refuses a write that sends a mask back. Here in tools/ because server code may not call
// fetch (ADR-002 L8).
import { randomUUID } from 'node:crypto';
import { defineContract, idString, listOf, pii } from '@radcore/lib-common';
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
// A table of radcore's that exists today, standing in for a module's own (`people`).
const TABLE = 'files';

const person = z.object({ id: idString(), name: z.string(), phone: pii(), salary: pii(z.string(), 'pay'),
  manager: z.object({ id: idString(), phone: pii() }).nullable() });
type Person = z.output<typeof person>;
const getPerson = defineContract({ method: 'POST', path: '/t/people/one', auth: 'session', perm: 'people:read', tx: read,
  records: TABLE, input: z.object({ id: idString() }), output: person });
const listPeople = defineContract({ method: 'POST', path: '/t/people/list', auth: 'session', perm: 'people:read', tx: read,
  records: TABLE, input: z.object({ ids: z.array(idString()) }), output: listOf(person) });
const savePerson = defineContract({ method: 'POST', path: '/t/people/save', auth: 'session', perm: 'people:read', tx: write,
  records: TABLE, input: z.object({ id: idString(), name: z.string(), phone: z.string().optional(),
    notes: z.array(z.object({ text: z.string() })).optional() }), output: person });
// Shows a pii() value with no record id around it, which can't be logged: a bug, so 500.
const noId = defineContract({ method: 'POST', path: '/t/people/no-id', auth: 'session', perm: 'people:read', tx: read,
  records: TABLE, input: z.object({}), output: z.object({ phone: pii() }) });

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
    defineRoute(getPerson, async (_ctx, { id }) => ({ ...someone(id), manager: { id: randomUUID(), phone: '+911234567890' } })),
    defineRoute(listPeople, async (_ctx, { ids }) => ({ items: ids.map(someone), next: null })),
    defineRoute(savePerson, async (_ctx, input) => {
      saved(input);
      return someone(input.id);
    }),
    defineRoute(noId, async () => ({ phone: '+919876543210' })),
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

  it('masks personal data without pii:read and pay without pay:read, a relation included, and logs no look', async () => {
    const id = randomUUID();
    await serve(as([]), async (post) => {
      const body = await (await post('/t/people/one', { id })).json() as Person;
      expect(body).toEqual({ ...someone(id), phone: MASKED_PHONE, salary: MASKED_PAY,
        manager: { id: expect.any(String) as string, phone: { masked: '••••••7890' } } });
    });
    expect(await looksAt([id])).toEqual([]);
  });

  it('shows pii:read personal data but still masks pay, and logs the look as the principal, before answering', async () => {
    const id = randomUUID();
    const reader = as(['pii:read']);
    await serve(reader, async (post) => {
      const body = await (await post('/t/people/one', { id })).json() as Person;
      expect([body.phone, body.salary]).toEqual(['+919876543210', MASKED_PAY]);
      // The look is in the log by the time the answer arrives.
      expect(await looksAt([id])).toEqual([{ record_table: TABLE, record_id: id,
        created_by: reader.kind === 'user' ? `user:${reader.userId}` : '' }]);
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

  it('refuses a write that sends a mask back, at any depth, before the service runs', async () => {
    saved.mockClear();
    await serve(as([]), async (post) => {
      for (const [body, path] of [[{ phone: '••••••3210' }, ['phone']], [{ notes: [{ text: 'ok' }, { text: '••••••' }] }, ['notes', 1, 'text']]] as const) {
        const res = await post('/t/people/save', { id: randomUUID(), name: 'Asha', ...body }, randomUUID());
        const err = await res.json() as { code: string; issues: { path: unknown[]; code: string }[] };
        expect([res.status, err.code, err.issues.map((i) => [i.path, i.code])]).toEqual([400, 'invalid_input', [[path, 'masked_value']]]);
      }
    });
    expect(saved).not.toHaveBeenCalled();
  });

  it('answers 500 for an unmasked value with no record id around it, since its look could not be logged', async () => {
    await serve(as(['pii:read']), async (post) => {
      expect((await post('/t/people/no-id', {})).status).toBe(500);
    });
  });
});
