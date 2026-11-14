// RAD-83 (ADR-001 §6a, RC-033, RC-044, D-19): custom roles and the built-in roles as templates, on a real PostgreSQL as
// the runtime login. Admin and owner create, copy, rename and delete roles and reset a built-in one, and nobody passes
// on a key they don't hold; a role holding a key that needs the second factor needs it, and its people sign in again.
// Each test works on roles of its own (keys t_…, which roles.test leaves out): other files run alongside.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError, roleNeedsSecondFactor, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import { listRolesFor, permissionMatrix, setRoleGrants } from '../packages/lib-platform/src/auth/roles-admin.ts';
import { createCustomRole, deleteCustomRole, keyFromName, renameRole, resetRoleToTemplate }
  from '../packages/lib-platform/src/auth/roles-custom.ts';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const reason = 'Setting up the new branch';
const PLAN = ['owner', 'admin', 'marketing', 'counter', 'sales', 'stores', 'accounts', 'hr', 'operations', 'technician', 'service_head'];

it('makes a role key from its name', () => {
  expect(['Field Sales (North)', '  Céline’s team ', 'हिसाब', 'X', `T ${'a'.repeat(40)}`].map(keyFromName))
    .toEqual(['field_sales_north', 'celine_s_team', 'role', 'role', `t_${'a'.repeat(27)}`]);
});

describe.skipIf(!url)('custom roles and templates', () => {
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

  /** A role of this test's own, with these grants (key → scope), and template rows if given, as a built-in role has. */
  async function role(grants: Record<string, 'all' | 'own'>, template?: Record<string, 'all' | 'own'>): Promise<string> {
    const key = `t_${letters()}`;
    await asAdmin("insert into radcore.roles (key, name, description) values ($1, $1, 'For roles-custom.test.ts')", [key]);
    for (const [permission, scope] of Object.entries(grants)) {
      await asAdmin('insert into radcore.role_grants (role, permission, scope) values ($1, $2, $3)', [key, permission, scope]);
    }
    for (const [permission, scope] of Object.entries(template ?? {})) {
      await asAdmin('insert into radcore.role_templates (role, permission, scope) values ($1, $2, $3)', [key, permission, scope]);
    }
    return key;
  }
  /** An active person with this role, signed in once, and the principal they load as. */
  async function person(roleKey: string): Promise<{ id: string; as: () => Promise<Principal>; sessionEnded: () => Promise<string | null> }> {
    const [row] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Test', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now(), $2) returning id`,
    [`person.${letters()}@example.in`, roleKey]);
    const id = row?.id ?? '';
    await asAdmin(`insert into radcore.sessions (user_id, token_hash, device, idle_expires_at, absolute_expires_at)
      values ($1, $2, 'Chrome on Android', now() + interval '30 minutes', now() + interval '12 hours')`,
    [id, createHash('sha256').update(randomUUID()).digest('hex')]);
    return { id, as: async () => (await run(SYSTEM, (ctx) => principalFor(ctx, id))) ?? SYSTEM,
      sessionEnded: async () => (await asAdmin<{ r: string | null }>('select ended_reason as r from radcore.sessions where user_id = $1', [id]))[0]?.r ?? null };
  }
  const grantsOf = async (key: string) => Object.fromEntries((await asAdmin<{ permission: string; scope: string }>(
    'select permission, scope from radcore.role_grants where role = $1', [key])).map((g) => [g.permission, g.scope]));
  const flagOf = async (key: string) =>
    (await asAdmin<{ f: boolean }>('select second_factor_required as f from radcore.roles where key = $1', [key]))[0]?.f;
  // The matrix's version is read fresh and the change retried on matrix_changed: other files change it alongside.
  async function withVersion(caller: Principal, change: (ctx: Ctx, version: string) => Promise<unknown>): Promise<string> {
    for (let i = 0; ; i += 1) {
      const { version } = await run(caller, permissionMatrix);
      const result = await outcome(run(caller, (ctx) => change(ctx, version)));
      if (result !== 'matrix_changed' || i === 4) return result;
    }
  }
  const create = (caller: Principal, name: string, copyFrom?: string) =>
    run(caller, (ctx) => createCustomRole(ctx, { name, description: 'Made by roles-custom.test.ts', copyFrom, reason }));
  const admin = async () => person('admin');
  // Someone who manages roles but isn't an admin, holding only these keys.
  const manager = async () => person(await role({ 'session:read': 'all', 'roles:read': 'all', 'roles:write': 'all', 'audit:read': 'all' }));

  it("seeds the plan's 11 roles as templates, each as it shipped, owner holding roles:write and users:write", async () => {
    const rows = await asAdmin<{ role: string; permission: string; scope: string }>(
      "select role, permission, scope from radcore.role_templates where role not like 't\\_%' order by role, permission");
    expect([...new Set(rows.map((r) => r.role))].toSorted()).toEqual(PLAN.toSorted());
    expect(rows.filter((r) => r.role === 'owner').map((r) => r.permission)).toEqual(expect.arrayContaining(['roles:write', 'users:write']));
    // Admin's template is the whole of admin's grants, which a test elsewhere checks is the whole catalogue.
    const admins = await asAdmin<{ permission: string }>("select permission from radcore.role_grants where role = 'admin' order by permission");
    expect(rows.filter((r) => r.role === 'admin').map((r) => r.permission)).toEqual(admins.map((a) => a.permission));
  });

  it('turns the second factor on for every role holding a key that needs it (D-19)', async () => {
    const holders = await asAdmin<{ key: string; f: boolean }>(`select distinct r.key, r.second_factor_required as f from radcore.roles r
      join radcore.role_grants g on g.role = r.key where g.permission = any($1) and r.key = any($2)`, [SECOND_FACTOR_KEYS, PLAN]);
    expect(holders.filter((h) => !h.f)).toEqual([]);
  });

  it('creates a blank role with only the signed-in basics, its key from its name, and no two names alike', async () => {
    const as = await (await admin()).as();
    const name = `T ${letters()}`;
    const { key } = await create(as, name);
    expect([key, await grantsOf(key), await flagOf(key)]).toEqual([keyFromName(name), { 'session:read': 'all' }, false]);
    // RC-044: case and spacing don't make a different name, so no two roles look alike on screen.
    expect(await outcome(create(as, `  ${name.toUpperCase().replace(' ', '   ')} `))).toBe('name_taken');
    // The same stem under a different name gets the next free key.
    expect((await create(as, `${name}!`)).key).toBe(`${key}_b`);
    const listed = (await run(as, listRolesFor)).roles.find((r) => r.key === key);
    expect([listed?.builtIn, (await run(as, listRolesFor)).roles.find((r) => r.key === 'sales')?.builtIn]).toEqual([false, true]);
  });

  it('copies grants and scopes, never people or the second-factor setting, and only keys the caller holds', async () => {
    const source = await role({ 'session:read': 'all', 'photo_files:read': 'own', 'audit:read': 'all' });
    await asAdmin('update radcore.roles set second_factor_required = true where key = $1', [source]);
    await person(source);
    const mgr = await (await manager()).as();
    // The manager lacks photo_files:read, so can't pass it on through a copy.
    expect(await outcome(create(mgr, `T ${letters()}`, source))).toBe('permission_not_held');
    const as = await (await admin()).as();
    const { key } = await create(as, `T ${letters()}`, source);
    expect([await grantsOf(key), await flagOf(key)]).toEqual([{ 'session:read': 'all', 'photo_files:read': 'own', 'audit:read': 'all' }, false]);
    expect((await asAdmin('select 1 from radcore.users where role = $1', [key]))).toEqual([]);
    expect((await create(as, `T ${letters()}`, source)).droppedKeys).toEqual([]);
    // D-20: owner holds pay:read, kept for admin and owner, so a copy of owner gets every key but that one, and says so,
    // in its answer and in the change's reason (the architect on RAD-83).
    const copy = await create(as, `T ${letters()}`, 'owner');
    const { 'pay:read': pay, ...rest } = await grantsOf('owner');
    expect([pay, await grantsOf(copy.key), copy.droppedKeys]).toEqual(['all', rest, ['pay:read']]);
    const why = await asAdmin<{ reason: string }>(`select distinct r.reason from radcore.audit_log a join radcore.change_reasons r
      on r.id = a.reason_id where a.table_name = 'roles' and a.record_id = $1`, [copy.key]);
    expect(why).toEqual([{ reason: `${reason} (Not copied, kept for named roles: pay:read)` }]);
    // A copy holding a key that needs the second factor needs it.
    const strong = await role({ 'session:read': 'all', 'users:write': 'all' });
    expect(await flagOf((await create(as, `T ${letters()}`, strong)).key)).toBe(true);
  });

  it('renames a role, though not admin, the caller’s own, one holding a key the caller lacks, or to a taken name', async () => {
    const a = await admin();
    const as = await a.as();
    const target = await role({ 'session:read': 'all' });
    const name = `T ${letters()}`;
    const rename = (caller: Principal, key: string, n: string) => outcome(run(caller, (ctx) => renameRole(ctx, { key, name: n, reason })));
    expect(await rename(as, target, name)).toBe('ok');
    expect((await asAdmin<{ name: string }>('select name from radcore.roles where key = $1', [target]))[0]?.name).toBe(name);
    expect(await rename(as, await role({ 'session:read': 'all' }), name.toLowerCase())).toBe('name_taken');
    expect(await rename(as, 'admin', `T ${letters()}`)).toBe('role_not_editable');
    const mgr = await manager();
    const own = ((await mgr.as()) as { role?: string }).role ?? '';
    expect(await rename(await mgr.as(), own, `T ${letters()}`)).toBe('role_not_editable');
    // The every-key rule (the auditor on #142): the manager lacks photo_files:read, so a role holding it isn't theirs to rename.
    const stronger = await role({ 'session:read': 'all', 'photo_files:read': 'own' });
    expect([await rename(await mgr.as(), stronger, `T ${letters()}`), await rename(await mgr.as(), target, `T ${letters()}`)])
      .toEqual(['permission_not_held', 'ok']);
  });

  it('deletes a custom role nobody holds, never one someone holds or a built-in one', async () => {
    const as = await (await admin()).as();
    const remove = (key: string) => outcome(run(as, (ctx) => deleteCustomRole(ctx, { key, reason })));
    const held = await role({ 'session:read': 'all' });
    const p = await person(held);
    await asAdmin("update radcore.users set status = 'disabled' where id = $1", [p.id]);
    // A deactivated person still holds it.
    expect(await remove(held)).toBe('role_in_use');
    expect(await remove('sales')).toBe('role_not_deletable');
    expect(await remove(await role({ 'session:read': 'all' }, { 'session:read': 'all' }))).toBe('role_not_deletable');
    const empty = await role({ 'session:read': 'all', 'audit:read': 'all' });
    // The every-key rule (the auditor on #142): the manager lacks photo_files:read, so can't delete a role holding it.
    const stronger = await role({ 'session:read': 'all', 'photo_files:read': 'own' });
    const mgr = await (await manager()).as();
    expect(await outcome(run(mgr, (ctx) => deleteCustomRole(ctx, { key: stronger, reason })))).toBe('permission_not_held');
    expect(await asAdmin('select 1 from radcore.roles where key = $1', [stronger])).toHaveLength(1);
    expect(await remove(empty)).toBe('ok');
    expect([await asAdmin('select 1 from radcore.roles where key = $1', [empty]), await grantsOf(empty)]).toEqual([[], {}]);
  });

  it('resets a built-in role to its template, scopes included, and its people sign in again', async () => {
    const template = { 'session:read': 'all', 'photo_files:read': 'own', 'audit:read': 'all' } as const;
    const builtIn = await role({ 'session:read': 'all', 'photo_files:read': 'all', 'users:read': 'all' }, template);
    const holder = await person(builtIn);
    const as = await (await admin()).as();
    const reset = (caller: Principal, key: string) => withVersion(caller, (ctx, version) => resetRoleToTemplate(ctx, { key, version, reason }));
    expect(await reset(as, builtIn)).toBe('ok');
    expect([await grantsOf(builtIn), await holder.sessionEnded()]).toEqual([template, 'role_changed']);
    expect(await reset(as, await role({ 'session:read': 'all' }))).toBe('not_a_template');
    // Nor does a reset give a key the caller doesn't hold: the manager lacks photo_files:read.
    const other = await role({ 'session:read': 'all' }, template);
    expect(await reset(await (await manager()).as(), other)).toBe('permission_not_held');
    expect(await grantsOf(other)).toEqual({ 'session:read': 'all' });
  });

  it('needs the second factor once a role gains a key that needs it, and its people sign in again (D-19)', async () => {
    const target = await role({ 'session:read': 'all' });
    const holder = await person(target);
    const as = await (await admin()).as();
    const needs = () => run(SYSTEM, (ctx) => roleNeedsSecondFactor(ctx, holder.id));
    expect(await needs()).toBe(false);
    expect(await withVersion(as, (ctx, version) => setRoleGrants(ctx, { key: target, grants: ['session:read', 'users:write'], version, reason })))
      .toBe('ok');
    expect([await flagOf(target), await needs(), await holder.sessionEnded()]).toEqual([true, true, 'role_changed']);
    // A stray grant made outside the app is caught too: the key alone asks for the factor.
    const stray = await role({ 'session:read': 'all', 'pay:read': 'all' });
    const p = await person(stray);
    expect([await flagOf(stray), await run(SYSTEM, (ctx) => roleNeedsSecondFactor(ctx, p.id))]).toEqual([false, true]);
  });

  it("lets owner manage roles, bounded by owner's own keys", async () => {
    const as = await (await person('owner')).as();
    const owners = as.permissions;
    expect(owners).toEqual(expect.arrayContaining(['roles:write', 'users:write']));
    const { key } = await create(as, `T ${letters()}`);
    const lacking = (await asAdmin<{ permission: string }>("select permission from radcore.role_grants where role = 'admin' order by permission"))
      .map((g) => g.permission).find((k) => !owners.includes(k));
    if (lacking === undefined) throw new Error('owner holds every key admin holds');
    expect(await withVersion(as, (ctx, version) => setRoleGrants(ctx, { key, grants: ['session:read', lacking], version, reason })))
      .toBe('permission_not_held');
  });
});
