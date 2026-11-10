// RAD-26 (M1-08, ADR-001 §6, ADR-002 §4, RC-080, RC-199, RC-216): the one generic route handler over real HTTP on a
// real PostgreSQL. Sign-in, input, permission, one transaction with the contract's timeout, the output checked
// before commit, camelCase as is, and errors mapped by code: a thrown code or a SQLSTATE, never message text.
// Here in tools/ because server code may not call fetch (ADR-002 L8). The tables live in a schema of this file's own.
import { randomBytes } from 'node:crypto';
import { defineContract } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { sql } from 'drizzle-orm';
import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import express from 'express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { listen } from '../apps/api/src/app.ts';
import { mountRoutes } from '../apps/api/src/http/handler.ts';
import { defineRoute } from '../apps/api/src/http/route.ts';
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
    const app = express();
    mountRoutes(app, [
      defineRoute(getNote, async (_ctx, { id }) => ({ noteId: id, bodyText: `note ${id}`, internal: 'dropped' })),
      defineRoute(addNote, addBehaviour),
      defineRoute(slow, async (ctx) => {
        await notesTx(ctx).select({ x: sql`pg_sleep(1)` }).from(notes).limit(1);
        return {};
      }),
      defineRoute(whoAmI, async (ctx) => ({ principal: (await notesTx(ctx).select({ p: sql<string>`current_setting('app.principal')` })
        .from(notes).limit(1))[0]?.p ?? 'none', requestId: ctx.requestId })),
    ], { db, log, authenticate: async () => principal });
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
  const post = (base: string, body: unknown) => fetch(`${base}/notes`, { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' } });
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

  it('answers a body that is not JSON 400 invalid_input', async () => {
    await serve(user(['notes:write']), insert, async (base) => {
      const res = await fetch(`${base}/notes`, { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } });
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

it('refuses to mount a webhook contract, which has its own lane (ADR-001 §6)', () => {
  const hook = defineContract({ method: 'POST', path: '/hooks/x', auth: 'webhook', perm: null, tx: { readOnly: false, isolation: 'read committed' },
    input: z.object({}), output: z.object({}) });
  expect(() => mountRoutes(express(), [defineRoute(hook, async () => ({}))], { db: createDatabase(new pg.Pool()), log: logger(),
    authenticate: async () => null })).toThrow(/webhook/);
});

function logger() {
  return { info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() };
}
