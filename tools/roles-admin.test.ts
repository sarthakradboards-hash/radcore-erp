// RAD-36 (M1-18, RC-033, RC-095): roles, the permission matrix and a person's role, on a real PostgreSQL as the
// runtime login. Nobody gives themselves more power: only an admin gives or takes the admin role, nobody changes their
// own role or their own role's grants, the admin role isn't edited, nobody grants a key they don't hold, no role loses
// the signed-in basics, and pay stays with admin and owner (D-20). A change applies at once, since keys are read fresh.
// Each test works on roles of its own: other files run alongside and the seeded roles are shared.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, roles } from '@radcore/db/platform';
import { defineContract } from '@radcore/lib-common';
import { AppError, defineRoute, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';
import platform from '../apps/api/src/routes/platform.ts';
import { listAuditTrailPage } from '../packages/lib-platform/src/audit-trail.ts';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import { changeUserRole, listRolesFor, permissionMatrix, setRoleGrants } from '../packages/lib-platform/src/auth/roles-admin.ts';
import { PERMISSIONS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
// A role key is letters and underscores only.
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const reason = 'Moving duties between teams';

describe.skipIf(!url)('roles and the permission matrix', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } finally {
      await c.end();
    }
  }
  const run = <R>(principal: Principal, fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, principal, randomUUID(), fn);
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  /** A role of this test's own, with these grants (key → scope). */
  async function role(grants: Record<string, 'all' | 'own'>): Promise<string> {
    // t_…, which roles.test leaves out of its look at the plan's roles.
    const key = `t_${letters()}`;
    await asAdmin("insert into radcore.roles (key, name, description) values ($1, $1, 'For roles-admin.test.ts')", [key]);
    for (const [permission, scope] of Object.entries(grants)) {
      await asAdmin('insert into radcore.role_grants (role, permission, scope) values ($1, $2, $3)', [key, permission, scope]);
    }
    return key;
  }
  /** An active person with this role, and the principal they sign in as, loaded as a request loads it. */
  async function person(roleKey: string): Promise<{ id: string; as: () => Promise<Principal> }> {
    const [row] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Test', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now(), $2) returning id`,
    [`person.${letters()}@example.in`, roleKey]);
    const id = row?.id ?? '';
    return { id, as: async () => (await run(SYSTEM, (ctx) => principalFor(ctx, id))) ?? SYSTEM };
  }
  const grantsOf = async (key: string) => asAdmin<{ permission: string; scope: string }>(
    'select permission, scope from radcore.role_grants where role = $1 order by permission', [key]);
  // Another test file may change the matrix between our read and write; the version check is what refuses that, so a
  // write here reads the version fresh and tries again on matrix_changed.
  async function setGrants(caller: Principal, key: string, grants: string[]): Promise<string> {
    for (let i = 0; ; i += 1) {
      const { version } = await run(caller, permissionMatrix);
      const result = await outcome(run(caller, (ctx) => setRoleGrants(ctx, { key, grants: grants.toSorted(), version, reason })));
      if (result !== 'matrix_changed' || i === 4) return result;
    }
  }
  const admin = async () => person('admin');
  // Someone who may manage roles and people but isn't an admin.
  const manager = async () => person(await role({ 'session:read': 'all', 'users:read': 'all', 'users:write': 'all',
    'roles:read': 'all', 'roles:write': 'all', 'audit:read': 'all' }));

  it('lists the roles with their people, and lets only an admin give the admin role', async () => {
    const target = await role({ 'session:read': 'all' });
    await person(target);
    await person(target);
    const fromAdmin = await run(await (await admin()).as(), listRolesFor);
    const fromManager = await run(await (await manager()).as(), listRolesFor);
    const pick = (r: typeof fromAdmin, key: string) => r.roles.find((x) => x.key === key);
    expect([pick(fromAdmin, target)?.userCount, pick(fromAdmin, 'admin')?.grantable, pick(fromManager, 'admin')?.grantable,
      pick(fromManager, target)?.grantable]).toEqual([2, true, false, true]);
    expect(pick(fromAdmin, 'admin')?.secondFactorRequired).toBe(true);
  });

  it('answers the matrix: every key in order, each role’s grants, and which roles the caller may edit', async () => {
    const target = await role({ 'session:read': 'all', 'audit:read': 'all' });
    const mgr = await manager();
    const matrix = await run(await mgr.as(), permissionMatrix);
    expect(matrix.version).toMatch(/^[0-9a-f]{64}$/);
    expect(matrix.permissions).toEqual(PERMISSIONS.map(({ key, module, label }) => ({ key, module, label })));
    const own = ((await mgr.as()) as { role?: string }).role;
    const pick = (key: string | undefined) => matrix.roles.find((r) => r.key === key);
    expect([pick(target)?.grants, pick(target)?.editable, pick('admin')?.editable, pick(own)?.editable])
      .toEqual([['audit:read', 'session:read'], true, false, false]);
  });

  it('replaces a role’s grants: kept keys keep their scope, it applies at once, and it is audited', async () => {
    const target = await role({ 'session:read': 'all', 'audit:read': 'all', 'photo_files:read': 'own' });
    const holder = await person(target);
    const a = await admin();
    expect(await setGrants(await a.as(), target, ['session:read', 'photo_files:read', 'users:read'])).toBe('ok');
    expect(await grantsOf(target)).toEqual([{ permission: 'photo_files:read', scope: 'own' },
      { permission: 'session:read', scope: 'all' }, { permission: 'users:read', scope: 'all' }]);
    // RC-095: the holder's very next request sees it; nothing was cached.
    const now = await holder.as();
    expect([now.permissions, now.kind === 'user' ? now.ownScope : null])
      .toEqual([['photo_files:read', 'session:read', 'users:read'], ['photo_files:read']]);
    const trail = await asAdmin<{ op: string; record_id: string; created_by: string }>(`select op, record_id, created_by
      from radcore.audit_log where table_name = 'role_grants' and record_id like $1 order by seq`, [`%${target}%`]);
    expect(trail.filter((t) => t.created_by === `user:${a.id}`).map((t) => t.op).toSorted()).toEqual(['delete', 'insert']);
  });

  it('refuses the admin role, the caller’s own role, a stale version and a key that isn’t one', async () => {
    const target = await role({ 'session:read': 'all' });
    const mgr = await manager();
    const as = await mgr.as();
    const own = (as as { role?: string }).role ?? '';
    const { version } = await run(as, permissionMatrix);
    const set = (key: string, grants: string[], v = version) => outcome(run(as, (ctx) => setRoleGrants(ctx, { key, grants, version: v, reason })));
    expect(await set('admin', ['session:read'])).toBe('role_not_editable');
    expect(await set(own, ['session:read'])).toBe('role_not_editable');
    expect(await set(target, ['session:read'], 'a'.repeat(64))).toBe('matrix_changed');
    const unknown = await run(as, (ctx) => setRoleGrants(ctx, { key: target, grants: ['leads:fly', 'session:read'], version, reason }))
      .catch((e: unknown) => e as AppError);
    expect([(unknown as AppError).code, (unknown as AppError).issues.map((i) => i.path)]).toEqual(['unknown_permission', [['grants', 0]]]);
    expect(await set('no_such_role', ['session:read'])).toBe('not_found');
    expect(await grantsOf(target)).toEqual([{ permission: 'session:read', scope: 'all' }]);
  });

  it('refuses a key the caller doesn’t hold, dropping the signed-in basics, and pay outside admin and owner', async () => {
    const target = await role({ 'session:read': 'all' });
    const mgr = await manager();
    const a = await admin();
    // The manager doesn't hold pii:read, so can't give it; the admin does.
    expect(await setGrants(await mgr.as(), target, ['session:read', 'pii:read'])).toBe('permission_not_held');
    expect(await setGrants(await a.as(), target, ['pii:read'])).toBe('basics_required');
    // D-20: the admin holds pay:read, but only admin and owner may.
    expect(await setGrants(await a.as(), target, ['session:read', 'pay:read'])).toBe('permission_not_for_role');
    expect(await grantsOf(target)).toEqual([{ permission: 'session:read', scope: 'all' }]);
    expect(await setGrants(await a.as(), target, ['session:read', 'pii:read'])).toBe('ok');
  });

  it("changes someone else's role, ending their sessions; only an admin gives or takes admin; never your own", async () => {
    const from = await role({ 'session:read': 'all' });
    const to = await role({ 'session:read': 'all', 'audit:read': 'all' });
    const p = await person(from);
    const mgr = await manager();
    const a = await admin();
    for (let i = 0; i < 2; i += 1) {
      await asAdmin(`insert into radcore.sessions (user_id, token_hash, device, idle_expires_at, absolute_expires_at)
        values ($1, $2, 'test', now() + interval '1 hour', now() + interval '2 hours')`, [p.id, randomBytes(32).toString('hex')]);
    }
    const change = async (caller: Principal, id: string, roleKey: string) =>
      outcome(run(caller, (ctx) => changeUserRole(ctx, { id, role: roleKey, reason })));
    expect(await change(await mgr.as(), mgr.id, to)).toBe('own_account');
    expect(await change(await mgr.as(), p.id, 'admin')).toBe('role_not_grantable');
    expect(await change(await mgr.as(), a.id, to)).toBe('role_not_grantable');
    expect(await change(await mgr.as(), p.id, 'no_such_role')).toBe('invalid_input');
    expect(await run(await mgr.as(), (ctx) => changeUserRole(ctx, { id: p.id, role: to, reason }))).toEqual({ sessionsEnded: 2 });
    expect(await asAdmin('select role, role_since is not null as since from radcore.users where id = $1', [p.id]))
      .toEqual([{ role: to, since: true }]);
    expect(await asAdmin('select ended_reason from radcore.sessions where user_id = $1', [p.id]))
      .toEqual([{ ended_reason: 'role_changed' }, { ended_reason: 'role_changed' }]);
    expect((await p.as()).permissions).toEqual(['audit:read', 'session:read']);
    // The same role again changes nothing.
    expect(await run(await mgr.as(), (ctx) => changeUserRole(ctx, { id: p.id, role: to, reason }))).toEqual({ sessionsEnded: 0 });
  });

  // The architect on RAD-36: the handler keeps a reason() field once, in change_reasons, and each audit row of the
  // change carries its id, never its text. A write that asks no reason leaves reason_id empty.
  it('keeps the typed reason once, each audit row of the change pointing at it, the text never in the audit log', async () => {
    const a = await admin();
    const as = await a.as();
    const target = await role({ 'session:read': 'all', 'audit:read': 'all' });
    const p = await person(target);
    const other = await role({ 'session:read': 'all' });
    // An audited write that asks no reason, through the same handler.
    const rename = defineRoute(defineContract({ method: 'POST', path: '/test/rename-role', auth: 'session', perm: 'roles:write',
      tx: write, input: z.object({ key: z.string(), description: z.string() }), output: z.object({}) }),
    async (ctx, { key, description }) => {
      await platformTx(ctx).update(roles).set({ description }).where(eq(roles.key, key));
      return {};
    });
    const cfg = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(cfg, { info: () => undefined, error: () => undefined },
      { db, authenticate: async () => as, routes: [...platform, rename] }), 0, '127.0.0.1');
    const send = (method: string, path: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}${path}`, { method,
      body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'idempotency-key': randomUUID() } });
    const why = [`Audit-only now ${letters()}`, `Moved to the other team ${letters()}`];
    try {
      const { version } = await run(as, permissionMatrix);
      expect((await send('PUT', `/admin/roles/${target}/permissions`, { grants: ['session:read', 'users:read'], version, reason: why[0] })).status).toBe(200);
      expect((await send('PUT', `/admin/users/${p.id}/role`, { role: other, reason: why[1] })).status).toBe(200);
      expect((await send('POST', '/test/rename-role', { key: other, description: 'Renamed' })).status).toBe(200);
    } finally {
      await server.stop();
    }
    const rows = await asAdmin<{ table_name: string; record_id: string; reason_id: string | null; text: string }>(`select table_name,
      record_id, reason_id::text, changed::text as text from radcore.audit_log where created_by = $1 order by seq`, [`user:${a.id}`]);
    const grants = rows.filter((r) => r.table_name === 'role_grants' && r.record_id.startsWith(target));
    const moved = rows.filter((r) => r.table_name === 'users' && r.record_id === p.id);
    const renamed = rows.filter((r) => r.table_name === 'roles' && r.record_id === other);
    // One change, one reason: both grant rows point at the same one; the role change at its own; the rename at none.
    expect([grants.length, new Set(grants.map((r) => r.reason_id)).size, moved.length, renamed.map((r) => r.reason_id)])
      .toEqual([2, 1, 1, [null]]);
    const kept = await asAdmin<{ id: string; reason: string }>('select id::text, reason from radcore.change_reasons where id = any($1::uuid[])',
      [[grants[0]?.reason_id, moved[0]?.reason_id]]);
    expect(Object.fromEntries(kept.map((k) => [k.id, k.reason])))
      .toEqual({ [grants[0]?.reason_id ?? '']: why[0], [moved[0]?.reason_id ?? '']: why[1] });
    expect(JSON.stringify(rows)).not.toContain(why[0]);
    expect(JSON.stringify(rows)).not.toContain(why[1]);
    // The audit view shows the text to audit:read, joined from its reference.
    const [today = ''] = (await asAdmin<{ d: string }>("select (now() at time zone 'Asia/Kolkata')::date::text as d")).map((r) => r.d);
    const page = await run(as, (ctx) => listAuditTrailPage(ctx, { filter: { occurred: { from: today, to: today }, tableName: 'users',
      recordId: p.id }, limit: 10 }));
    // Newest first: the role change, with its reason; then the person's creation, which asked none.
    expect(page.items.map((i) => i.reason)).toEqual([why[1], null]);
  });

  it('lets two admins demoting each other at once take turns: the second is no longer an admin', async () => {
    const [x, y] = [await admin(), await admin()];
    const keep = await role({ 'session:read': 'all' });
    const [xa, ya] = [await x.as(), await y.as()];
    const results = await Promise.all([outcome(run(xa, (ctx) => changeUserRole(ctx, { id: y.id, role: keep, reason }))),
      outcome(run(ya, (ctx) => changeUserRole(ctx, { id: x.id, role: keep, reason })))]);
    expect(results.toSorted()).toEqual(['ok', 'role_not_grantable']);
    expect((await asAdmin<{ role: string }>('select role from radcore.users where id = any($1) order by role', [[x.id, y.id]]))
      .map((r) => r.role).filter((r) => r === 'admin')).toHaveLength(1);
  });
});
