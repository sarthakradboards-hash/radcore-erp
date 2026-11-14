// RAD-41 (RC-047, ADR-001 §6a) over real HTTP on PostgreSQL 16: an `auth: 'link'` route runs as the link's holder,
// on its one record, with the token stripped before the service; a bad token, whatever is wrong with it, gets one
// answer; answers are noindex and no-store; and what the holder opened is in access_log under the link's id. Here in
// tools/ because server code may not call fetch (ADR-002 L8).
import { randomUUID } from 'node:crypto';
import { defineContract } from '@radcore/lib-common';
import { createLink, defineRoute, loadConfig, revokeLink, useLink, type Ctx, type Principal } from '@radcore/lib-platform';
import { linkToken } from '@radcore/lib-platform/contract';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const DAY = 86_400_000;
const VIEW = 'sales.invoice_view';
const ACCEPT = 'sales.estimate_accept';
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['sales:write'] };

// Two link routes as a module would declare them: a read (no key), and a write (an ordinary write, with its key).
const view = defineContract({ method: 'POST', path: '/l/invoice', auth: 'link', action: VIEW, rateLimit: 'token-link',
  perm: null, tx: { readOnly: true, isolation: 'read committed' }, input: z.object({ token: linkToken(), note: z.string() }),
  output: z.object({ recordId: z.string(), heard: z.array(z.string()) }) });
const accept = defineContract({ method: 'POST', path: '/l/estimate/accept', auth: 'link', action: ACCEPT,
  rateLimit: 'token-link', perm: null, tx: WRITE, input: z.object({ token: linkToken() }), output: z.object({}) });

describe.skipIf(!url || !superUrl)('link routes', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const seen = vi.fn<(principal: Principal, input: unknown) => void>();
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  const routes = [
    defineRoute(view, async (ctx: Ctx, input) => {
      seen(ctx.principal, input);
      return { recordId: ctx.principal.kind === 'link' ? ctx.principal.recordId : '', heard: Object.keys(input).sort() };
    }),
    // The handler spends the link's use with this write; the service doesn't (auditor on #134).
    defineRoute(accept, async () => ({})),
  ];
  // A session comes with the request too: a link route must ignore it and run as the link's holder only.
  async function serve(fn: (post: (path: string, body: object, key?: string | null) => Promise<Response>) => Promise<void>) {
    const app = createApp(config(), logger(), { db, authenticate: async () => staff, routes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn((path, body, key = null) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...(key === null ? {} : { 'idempotency-key': key }) } }));
    } finally {
      await server.stop();
    }
  }
  const dbNow = async () => (await pool.query<{ now: Date }>('select now()')).rows[0]?.now ?? new Date(0);
  const made = async (action: string, over: { uses?: number } = {}) => {
    const recordId = randomUUID();
    const expiresAt = new Date((await dbNow()).getTime() + 7 * DAY);
    const link = await runInTransaction(db, WRITE, staff, randomUUID(), (ctx) => createLink(ctx, { action, recordId, expiresAt,
      ...(over.uses === undefined ? {} : { uses: over.uses }) }));
    return { ...link, recordId, expiresAt };
  };
  // An answer as the caller sees it, its request id aside (each request has its own).
  const answer = async (res: Response): Promise<{ status: number; body: Record<string, unknown> }> => {
    const body = await res.json() as Record<string, unknown>;
    return { status: res.status, body: { ...body, requestId: typeof body['requestId'] } };
  };

  it('runs as the link\'s holder on its one record, never sees the token, answers noindex and no-store, and logs the access', async () => {
    const { id, token, recordId } = await made(VIEW);
    await serve(async (post) => {
      const res = await post('/l/invoice', { token, note: 'hi' });
      expect([res.status, res.headers.get('x-robots-tag'), res.headers.get('cache-control'), await res.json()])
        .toEqual([200, 'noindex', 'no-store', { recordId, heard: ['note'] }]);
    });
    expect(seen).toHaveBeenCalledWith({ kind: 'link', linkId: id, action: VIEW, recordId, permissions: [] }, { note: 'hi' });
    expect((await admin.query('select record_table, record_id, created_by from radcore.access_log where created_by = $1',
      [`link:${id}`])).rows).toEqual([{ record_table: VIEW, record_id: recordId, created_by: `link:${id}` }]);
  });

  it('gives one answer to every token that isn\'t a live link for this action, whatever is wrong with it', async () => {
    const revoked = await made(VIEW);
    await runInTransaction(db, WRITE, staff, randomUUID(), (ctx) => revokeLink(ctx, revoked.id));
    const usedUp = await made(VIEW, { uses: 1 });
    await runInTransaction(db, WRITE, { kind: 'link', linkId: usedUp.id, action: VIEW, recordId: usedUp.recordId, permissions: [] },
      randomUUID(), (ctx) => useLink(ctx));
    const otherAction = await made(ACCEPT);
    const expired = await made(VIEW);
    seen.mockClear();
    const bad = { unknown: `${'x'.repeat(40)}0`, revoked: revoked.token, usedUp: usedUp.token, otherAction: otherAction.token };
    const answers: Record<string, unknown> = {};
    await serve(async (post) => {
      for (const [why, token] of Object.entries(bad)) answers[why] = await answer(await post('/l/invoice', { token, note: '' }));
      // After its expiry, by the clock the handler reads.
      vi.useFakeTimers({ now: new Date(expired.expiresAt.getTime() + 1000), toFake: ['Date'] });
      answers['expired'] = await answer(await post('/l/invoice', { token: expired.token, note: '' }));
    });
    const notFound = { status: 404, body: { code: 'not_found', message: 'Not found', issues: [], requestId: 'string' } };
    expect(answers).toEqual({ unknown: notFound, revoked: notFound, usedUp: notFound, otherAction: notFound, expired: notFound });
    expect(seen).not.toHaveBeenCalled();
  });

  it("serves only the link's own record, whatever other record the body names", async () => {
    const { token, recordId } = await made(VIEW);
    await serve(async (post) => {
      const res = await post('/l/invoice', { token, note: 'x', invoiceId: randomUUID(), id: randomUUID() });
      expect([res.status, await res.json()]).toEqual([200, { recordId, heard: ['note'] }]);
    });
  });

  it("spends a read-only link's use itself: a single-use link answers once, then not_found", async () => {
    const { token } = await made(VIEW, { uses: 1 });
    await serve(async (post) => {
      expect((await post('/l/invoice', { token, note: '' })).status).toBe(200);
      expect((await answer(await post('/l/invoice', { token, note: '' }))).status).toBe(404);
    });
  });

  it('treats a link that changes something as an ordinary write: it needs its key, and a single use goes once', async () => {
    const { token } = await made(ACCEPT, { uses: 1 });
    await serve(async (post) => {
      expect((await answer(await post('/l/estimate/accept', { token }))).body['code']).toBe('idempotency_key_required');
      expect((await post('/l/estimate/accept', { token }, randomUUID())).status).toBe(200);
      expect((await answer(await post('/l/estimate/accept', { token }, randomUUID()))).status).toBe(404);
    });
  });
});
