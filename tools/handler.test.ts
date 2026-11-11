// RAD-26 (M1-08, ADR-001 §6, ADR-002 §4, RC-080, RC-199, RC-216): the one generic route handler over real HTTP on a
// real PostgreSQL. Sign-in, input, permission, one transaction with the contract's timeout, the output checked
// before commit, camelCase as is, and errors mapped by code: a thrown code or a SQLSTATE, never message text.
// Here in tools/ because server code may not call fetch (ADR-002 L8). The tables live in a schema of this file's own.
import { randomBytes, randomUUID } from 'node:crypto';
import { defineContract, newPassword } from '@radcore/lib-common';
import { AppError, defineRoute, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { sql } from 'drizzle-orm';
import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { createApp, listen } from '../apps/api/src/app.ts';
import type { HandlerDeps } from '../apps/api/src/http/handler.ts';
import { moduleTx } from '../packages/db/src/module-tx.ts';
import { createDatabase } from '../packages/lib-platform/src/db/client.ts';

// The owner login: this file makes a schema and a table of its own (RAD-24).
const url = process.env['TEST_DATABASE_OWNER_URL'];
const fixture = pgSchema(`handler_${randomBytes(6).toString('hex')}`);
const notes = fixture.table('notes', { id: uuid().primaryKey().defaultRandom(), body: text().notNull(), n: integer().notNull() });
const notesTx = moduleTx({ notes });

const NoteOut = z.object({ noteId: z.string(), bodyText: z.string() });
const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const getNote = defineContract({ method: 'GET', path: '/notes/:id', auth: 'session', perm: 'notes:read', tx: read,
  input: z.object({ id: z.string().min(1) }), output: NoteOut });
const addNote = defineContract({ method: 'POST', path: '/notes', auth: 'session', perm: 'notes:write', tx: write,
  input: z.object({ body: z.string().min(1), n: z.number().int() }), output: z.object({ id: z.string() }),
  errors: ['note_too_long'] });
const slow = defineContract({ method: 'GET', path: '/slow', auth: 'session', perm: 'notes:read',
  tx: { ...read, statementTimeoutMs: 50 }, input: z.object({}), output: z.object({}) });
const whoAmI = defineContract({ method: 'GET', path: '/who', auth: 'session', perm: 'notes:read', tx: read,
  input: z.object({}), output: z.object({ principal: z.string(), requestId: z.string() }) });

// ADR-001 §7a: a key-exempt write, on a route of lib-platform's fixed list; and one that isn't on it.
const exemptSignOut = defineContract({ method: 'POST', path: '/sign-out', auth: 'session', perm: 'session:read',
  idempotency: 'exempt', tx: write, input: z.object({}), output: z.object({}) });
const offListExempt = defineContract({ method: 'POST', path: '/notes/quick', auth: 'session', perm: 'notes:write',
  idempotency: 'exempt', tx: write, input: z.object({}), output: z.object({}) });
const offListNoAnswer = defineContract({ method: 'POST', path: '/notes/secret', auth: 'session', perm: 'notes:write',
  storesAnswer: false, tx: write, input: z.object({}), output: z.object({}) });
// Every write comes from the app's own origin (ADR-001 §7a, M1-21), as the browser sends it.
const ORIGIN = config().publicOrigin;
const user = (permissions: string[]): Principal => ({ kind: 'user', userId: 'u-1', permissions });
const PERSONAL = 'Asha Rao';

type Behaviour = (ctx: Ctx, input: { body: string; n: number }) => Promise<{ id: string }>;

describe.skipIf(!url)('the generic route handler', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool, { notes });

  beforeAll(async () => {
    await pool.query(`create schema ${fixture.schemaName}`);
    await pool.query(`create table ${fixture.schemaName}.notes (id uuid primary key default gen_random_uuid(),
      body text not null unique, n int not null)`);
    // The slow and /who routes read one row, so there is always one.
    await pool.query(`insert into ${fixture.schemaName}.notes (body, n) values ('seed', 0)`);
  });
  afterAll(async () => {
    await pool.query(`drop schema ${fixture.schemaName} cascade`);
    await pool.end();
  });

  // A server with these routes, signed in as `principal` (null: signed out); each test gets its own.
  async function serve(principal: Principal | null, addBehaviour: Behaviour, fn: (base: string, log: ReturnType<typeof logger>) => Promise<void>) {
    const log = logger();
    const app = createApp(config(), log, { db, authenticate: async () => principal, routes: [
      defineRoute(getNote, async (_ctx, { id }) => ({ noteId: id, bodyText: `note ${id}`, internal: 'dropped' })),
      defineRoute(addNote, addBehaviour),
      defineRoute(exemptSignOut, signOutService),
      defineRoute(slow, async (ctx) => {
        await notesTx(ctx).select({ x: sql`pg_sleep(1)` }).from(notes).limit(1);
        return {};
      }),
      defineRoute(whoAmI, async (ctx) => ({ principal: (await notesTx(ctx).select({ p: sql<string>`current_setting('app.principal')` })
        .from(notes).limit(1))[0]?.p ?? 'none', requestId: ctx.requestId })),
    ] });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn(`http://127.0.0.1:${server.port}`, log);
    } finally {
      await server.stop();
    }
  }
  const insert: Behaviour = async (ctx, input) => {
    const [row] = await notesTx(ctx).insert(notes).values(input).returning({ id: notes.id });
    return { id: row?.id ?? '' };
  };
  const signOutService = vi.fn(async () => ({}));
  // Every write carries its saved-once key (ADR-001 §7a): a UUID, new per submit.
  const post = (base: string, body: unknown, key: string | null = randomUUID()) => fetch(`${base}/notes`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(key === null ? {} : { 'idempotency-key': key }) } });
  const count = async (body: string) => Number((await pool.query(`select count(*) from ${fixture.schemaName}.notes where body = $1`,
    [body])).rows[0]?.count);
  const envelope = { code: expect.any(String), message: expect.any(String), issues: expect.any(Array), requestId: expect.any(String) };

  it('answers a signed-out request 401 signed_out, before the service runs', async () => {
    const service = vi.fn(insert);
    await serve(null, service, async (base) => {
      const res = await post(base, { body: 'x', n: 1 });
      expect([res.status, await res.json()]).toEqual([401, { ...envelope, code: 'signed_out' }]);
    });
    expect(service).not.toHaveBeenCalled();
  });

  it('answers invalid input 400 with an issue per field, before the service runs', async () => {
    const service = vi.fn(insert);
    await serve(user(['notes:write']), service, async (base) => {
      const res = await post(base, { body: '', n: 1.5 });
      const body = (await res.json()) as { code: string; issues: { path: unknown[] }[] };
      expect([res.status, body.code, body.issues.map((i) => i.path)]).toEqual([400, 'invalid_input', [['body'], ['n']]]);
    });
    expect(service).not.toHaveBeenCalled();
  });

  it('answers a principal without the route permission 403 forbidden, before the service runs', async () => {
    const service = vi.fn(insert);
    await serve(user(['notes:read']), service, async (base) => {
      const res = await post(base, { body: 'x', n: 1 });
      expect([res.status, await res.json()]).toEqual([403, { ...envelope, code: 'forbidden' }]);
    });
    expect(service).not.toHaveBeenCalled();
  });

  it('runs the service and answers its output as declared: camelCase as is, undeclared keys dropped', async () => {
    await serve(user(['notes:read']), insert, async (base) => {
      const res = await fetch(`${base}/notes/n-7`);
      expect([res.status, await res.json()]).toEqual([200, { noteId: 'n-7', bodyText: 'note n-7' }]);
    });
  });

  it('commits a write, as the signed-in principal with this request id', async () => {
    const body = `committed ${randomBytes(4).toString('hex')}`;
    await serve(user(['notes:write', 'notes:read']), insert, async (base) => {
      const res = await post(base, { body, n: 1 });
      expect(res.status).toBe(200);
      expect(await count(body)).toBe(1);
      const who = (await (await fetch(`${base}/who`)).json()) as { principal: string; requestId: string };
      expect(who.principal).toBe('user:u-1');
      expect(who.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('rolls the write back and answers 500 when the output breaks the contract', async () => {
    const body = `bad output ${randomBytes(4).toString('hex')}`;
    await serve(user(['notes:write']), async (ctx, input) => {
      await insert(ctx, input);
      return { id: 42 } as unknown as { id: string };
    }, async (base) => {
      const res = await post(base, { body, n: 1 });
      expect([res.status, await res.json()]).toEqual([500, { ...envelope, code: 'server_error' }]);
    });
    expect(await count(body)).toBe(0);
  });

  it("maps a declared business code to 422, keeping the service's message, and rolls back", async () => {
    const body = `too long ${randomBytes(4).toString('hex')}`;
    await serve(user(['notes:write']), async (ctx, input) => {
      await insert(ctx, input);
      throw new AppError('note_too_long', 'A note can be 200 characters at most');
    }, async (base) => {
      const res = await post(base, { body, n: 1 });
      expect([res.status, await res.json()]).toEqual([422,
        { ...envelope, code: 'note_too_long', message: 'A note can be 200 characters at most' }]);
    });
    expect(await count(body)).toBe(0);
  });

  // ADR-001 §7a (RAD-61): only rate_limited and account_locked say when to retry, in the body and in Retry-After.
  it('answers account_locked with retryAfterSeconds and the same Retry-After header, and other codes with neither', async () => {
    let thrown = new AppError('account_locked', 'Locked for now', [], 840);
    await serve(user(['notes:write']), async () => {
      throw thrown;
    }, async (base) => {
      const locked = await post(base, { body: 'x', n: 1 });
      expect([locked.status, locked.headers.get('retry-after'), ((await locked.json()) as { retryAfterSeconds?: number }).retryAfterSeconds])
        .toEqual([429, '840', 840]);
      thrown = new AppError('not_found', 'Gone', [], 840);
      const other = await post(base, { body: 'x', n: 1 });
      expect([other.status, other.headers.get('retry-after'), 'retryAfterSeconds' in ((await other.json()) as object)])
        .toEqual([404, null, false]);
    });
  });

  it('maps a platform code to its status, and a code the contract does not list to 500', async () => {
    let code = 'not_found';
    await serve(user(['notes:write']), async () => {
      throw new AppError(code, 'That note is gone');
    }, async (base) => {
      expect((await post(base, { body: 'x', n: 1 })).status).toBe(404);
      code = 'not_listed_anywhere';
      const res = await post(base, { body: 'x', n: 1 });
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([500, 'server_error']);
    });
  });

  // RC-216: matched by code, never by message text.
  it('maps a unique violation by SQLSTATE to 409 conflict, and an error that only says "duplicate key" to 500', async () => {
    const body = `twice ${randomBytes(4).toString('hex')}`;
    await serve(user(['notes:write']), insert, async (base) => {
      expect((await post(base, { body, n: 1 })).status).toBe(200);
      const res = await post(base, { body, n: 2 });
      const answer = (await res.json()) as { code: string; message: string };
      expect([res.status, answer.code]).toEqual([409, 'conflict']);
      expect(answer.message).not.toMatch(/duplicate|unique|notes/i);
    });
    await serve(user(['notes:write']), async () => {
      throw new Error('duplicate key value violates unique constraint');
    }, async (base) => {
      expect((await post(base, { body: 'x', n: 1 })).status).toBe(500);
    });
  });

  // RC-080: the contract's statement timeout holds for its transaction.
  it("cancels a statement past the contract's timeout and answers 500", async () => {
    await serve(user(['notes:read']), insert, async (base) => {
      const res = await fetch(`${base}/slow`);
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([500, 'server_error']);
    });
  });

  // Saved-once (M1-09) stores and replays answers; until then the key is still required, so writes fail closed (RC-132).
  it('refuses a write without a UUID idempotency key, before the service runs', async () => {
    const service = vi.fn(insert);
    await serve(user(['notes:write']), service, async (base) => {
      for (const key of [null, 'not-a-uuid']) {
        const res = await post(base, { body: 'x', n: 1 }, key);
        expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([400, 'idempotency_key_required']);
      }
    });
    expect(service).not.toHaveBeenCalled();
  });

  it('runs a key-exempt write without a key, and still refuses any other write without one (ADR-001 §7a)', async () => {
    const service = vi.fn(insert);
    signOutService.mockClear();
    await serve(user(['session:read', 'notes:write']), service, async (base) => {
      const out = await fetch(`${base}/sign-out`, { method: 'POST', body: '{}',
        headers: { 'content-type': 'application/json', origin: ORIGIN } });
      expect(out.status).toBe(200);
      const res = await post(base, { body: 'keyless', n: 1 }, null);
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([400, 'idempotency_key_required']);
    });
    expect(signOutService).toHaveBeenCalledTimes(1);
    expect(service).not.toHaveBeenCalled();
  });

  it('marks every answer no-store, and never names the server', async () => {
    await serve(user(['notes:read']), insert, async (base) => {
      for (const res of [await fetch(`${base}/notes/n-1`), await post(base, { body: '', n: 1 }), await fetch(`${base}/who`)]) {
        expect([res.headers.get('cache-control'), res.headers.get('x-powered-by')]).toEqual(['no-store', null]);
      }
    });
  });

  it("answers server_error with the platform's message, never the service's", async () => {
    await serve(user(['notes:write']), async () => {
      throw new AppError('server_error', 'pool exhausted on db-7');
    }, async (base) => {
      const res = await post(base, { body: 'x', n: 1 });
      expect([res.status, ((await res.json()) as { message: string }).message]).toEqual([500, 'Something went wrong on our side']);
    });
  });

  it('answers a body that is not JSON 400 invalid_input', async () => {
    await serve(user(['notes:write']), insert, async (base) => {
      const res = await fetch(`${base}/notes`, { method: 'POST', body: '{not json',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), origin: ORIGIN } });
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([400, 'invalid_input']);
    });
  });

  it('logs ids, never what was sent', async () => {
    await serve(user(['notes:write']), async () => {
      throw new Error(`could not save ${PERSONAL}`);
    }, async (base, log) => {
      const res = await post(base, { body: PERSONAL, n: 1 });
      const { requestId } = (await res.json()) as { requestId: string };
      const lines = log.error.mock.calls.map(([m]) => m);
      expect(lines).toEqual([`POST /notes failed (request ${requestId})`]);
      expect(JSON.stringify(log.error.mock.calls.map(([m]) => m))).not.toContain(PERSONAL);
    });
  });
});

// ADR-001 §7a (RAD-32): a field marked newPassword() is checked before the transaction opens, so the check's network
// call never holds a transaction or a pooled connection, and a refusal never reaches the service.
describe.skipIf(!url)('the new-password check before the transaction', () => {
  const setPassword = defineContract({ method: 'POST', path: '/passwords', auth: 'session', perm: 'notes:write',
    tx: { readOnly: false, isolation: 'read committed' }, input: z.object({ password: newPassword() }), output: z.object({}),
    errors: ['password_rejected'] });
  const check = vi.fn(async (p: string) => (p.length < 15 ? 'too_short' as const : p.includes('breach') ? 'breached' as const : null));

  it('refuses a short or breached password with password_rejected on its field, before the service and the transaction', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const service = vi.fn(async () => ({}));
    const app = createApp(config(), logger(), { db: createDatabase(pool), authenticate: async () => user(['notes:write']),
      newPasswordCheck: check, routes: [defineRoute(setPassword, service)] });
    const server = await listen(app, 0, '127.0.0.1');
    const send = async (password: string) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/passwords`, { method: 'POST', body: JSON.stringify({ password }),
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), origin: ORIGIN } });
      const body = (await res.json()) as { code?: string; issues?: { path: unknown[]; code: string }[] };
      return [res.status, body.code, body.issues?.map((i) => [i.path, i.code])];
    };
    try {
      expect(await send('too short')).toEqual([422, 'password_rejected', [[['password'], 'too_short']]]);
      expect(await send('a breach of the lighthouse')).toEqual([422, 'password_rejected', [[['password'], 'breached']]]);
      expect(service).not.toHaveBeenCalled();
      expect(await send('the lighthouse keeps its own time')).toEqual([200, undefined, undefined]);
      expect(service).toHaveBeenCalledTimes(1);
    } finally {
      await server.stop();
      await pool.end();
    }
  });

  // The auditor's SHOULD on #100: a wrapped input would hide the field, so the three password routes must show one.
  it('refuses to mount a password route whose new password the check cannot find', () => {
    const hidden = defineContract({ method: 'POST', path: '/invites/accept', auth: 'public', rateLimit: 'token-link', perm: null,
      tx: { readOnly: false, isolation: 'read committed' }, input: z.object({ token: z.string(), password: z.string() }),
      output: z.object({}), errors: ['password_rejected'] });
    expect(() => createApp(config(), logger(), { db: createDatabase(new pg.Pool()), authenticate: async () => null,
      newPasswordCheck: check, routes: [defineRoute(hidden, async () => ({}))] })).toThrow(/newPassword\(\) field/);
  });

  it('refuses to mount a newPassword() field without a check to run (fails closed)', () => {
    expect(() => createApp(config(), logger(), { db: createDatabase(new pg.Pool()), authenticate: async () => null,
      routes: [defineRoute(setPassword, async () => ({}))] })).toThrow(/new-password check/);
  });
});

it('refuses to mount a webhook contract, which has its own lane (ADR-001 §6)', () => {
  const hook = defineContract({ method: 'POST', path: '/hooks/x', auth: 'webhook', perm: null, tx: { readOnly: false, isolation: 'read committed' },
    input: z.object({}), output: z.object({}) });
  expect(() => createApp(config(), logger(), { db: createDatabase(new pg.Pool()), authenticate: async () => null,
    routes: [defineRoute(hook, async () => ({}))] })).toThrow(/webhook/);
});

// The app's settings; the handler's database is the one each test passes in, so this URL is never used.
function config() {
  return loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
}

function logger() {
  return { info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() };
}

// ADR-001 §7a: the handler refuses to start with an exemption or a kept-nothing answer off lib-platform's fixed lists.
// Mounting checks the routes before any request, so this needs no database.
it("refuses to mount a route that declares either saved-once flag outside lib-platform's fixed lists", () => {
  // Nothing is served, so no database is needed.
  const app = (route: ReturnType<typeof defineRoute>) =>
    createApp(config(), logger(), { db: undefined as unknown as HandlerDeps['db'], authenticate: async () => null, routes: [route] });
  expect(() => app(defineRoute(offListExempt, async () => ({})))).toThrow(/KEY_EXEMPT_ROUTES/);
  expect(() => app(defineRoute(offListNoAnswer, async () => ({})))).toThrow(/ANSWER_NOT_STORED_ROUTES/);
  expect(() => app(defineRoute(exemptSignOut, async () => ({})))).not.toThrow();
});

// M1-21, RC-165: a write needs Origin to be exactly PUBLIC_ORIGIN, the key-exempt routes above all: they send no
// custom header, so a cross-site form post makes no CORS preflight (login CSRF). The guard answers before the
// principal, the body or a transaction, so these need no database.
describe('the write-Origin check', () => {
  const signIn = defineContract({ method: 'POST', path: '/sign-in', auth: 'public', rateLimit: 'sign-in', perm: null,
    idempotency: 'exempt', tx: write, input: z.object({ email: z.string() }), output: z.object({}) });
  const service = vi.fn(async () => ({}));
  const authenticate = vi.fn(async () => null);

  async function send(origin: string | null, body = '{}') {
    const app = createApp(config(), logger(), { db: createDatabase(new pg.Pool()), authenticate,
      routes: [defineRoute(signIn, service), defineRoute(getNote, async (_ctx, { id }) => ({ noteId: id, bodyText: '' }))] });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/sign-in`, { method: 'POST', body,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin === null ? {} : { origin }) } });
      return { status: res.status, code: ((await res.json()) as { code: string }).code };
    } finally {
      await server.stop();
    }
  }

  it.each<[string, string | null]>([
    ['a cross-site form post', 'https://evil.example'],
    ['a write with no Origin (RC-165)', null],
    ["the browser's opaque origin", 'null'],
  ])('refuses %s to /sign-in with 403 forbidden, before anything else runs', async (_, origin) => {
    service.mockClear();
    authenticate.mockClear();
    expect(await send(origin)).toEqual({ status: 403, code: 'forbidden' });
    expect(authenticate).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  it('lets a same-origin post to /sign-in through the guard, to be checked as usual', async () => {
    // Past the guard, the body is read: a form body isn't the contract's JSON, so it answers 400, not 403.
    expect(await send(ORIGIN, 'email=asha%40example.com')).toEqual({ status: 400, code: 'invalid_input' });
  });

  it('asks no Origin of a read', async () => {
    const app = createApp(config(), logger(), { db: createDatabase(new pg.Pool()), authenticate: async () => null,
      routes: [defineRoute(getNote, async (_ctx, { id }) => ({ noteId: id, bodyText: '' }))] });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      // Past the guard with no Origin, the read stops at the session check (401), not the guard (403).
      const res = await fetch(`http://127.0.0.1:${server.port}/notes/n1`);
      expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([401, 'signed_out']);
    } finally {
      await server.stop();
    }
  });
});
