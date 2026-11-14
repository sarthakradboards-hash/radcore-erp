// RAD-35 (M1-17, RC-042, RC-095, ADR-001 §6a; the plan's page 4): roles on a real PostgreSQL 16 as the app login. The
// plan's 11 roles are seeded with D-19's second factor; admin holds every key a lib-platform contract declares; a
// person's principal is their role's keys, read fresh each time, each key over every record or only their own; a
// record outside their scope is not_found; and a new role ends their sessions.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as contracts from '@radcore/lib-platform/contract';
import { assignRole, roleNeedsSecondFactor, type Principal } from '@radcore/lib-platform';
import { createDatabase, loadPrincipal, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { secondFactorStatus } from '../packages/lib-platform/src/auth/second-factor-status.ts';

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the role tests must run, not skip');
});

// Every route contract lib-platform declares, groups (a file kind's three routes) opened one level.
const declared = Object.values(contracts).flatMap((c): unknown[] => (typeof c === 'object' && c !== null && !('path' in c) ? Object.values(c) : [c]))
  .filter((c): c is { perm: string | null } => typeof c === 'object' && c !== null && 'path' in c && 'perm' in c);

describe.skipIf(!url)('roles and record scope', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const write = { readOnly: false, isolation: 'read committed' } as const;
  const asTest: Principal = { kind: 'system', name: 'test', permissions: [] };
  const load = loadPrincipal(db);

  // Statements as system:test, committed: a role and its people are this test's own, so nothing reaches another's.
  async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } finally {
      c.release();
    }
  }
  // Role keys are lower-case letters and underscores.
  const roleKey = () => `t_${[...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
  const activePerson = async (role: string) => (await sql<{ id: string }>(`insert into radcore.users
    (email, display_name, status, password_hash, role) values ($1, 'Test person', 'active', 'x', $2) returning id`,
  [`p-${randomUUID()}@example.test`, role]))[0]?.id ?? '';

  it("seeds the plan's 11 roles, one key per role, with D-19's second factor on owner, admin, accounts and HR", async () => {
    const rows = await sql<{ key: string; second: boolean }>(
      "select key, second_factor_required as second from radcore.roles where key not like 't\\_%' order by key");
    expect(rows.map((r) => r.key)).toEqual(['accounts', 'admin', 'counter', 'hr', 'marketing', 'operations', 'owner', 'sales',
      'service_head', 'stores', 'technician']);
    expect(rows.filter((r) => r.second).map((r) => r.key)).toEqual(['accounts', 'admin', 'hr', 'owner']);
    // RC-044: no two roles a letter apart, such as v1's store and stores.
    expect(rows.map((r) => r.key)).not.toContain('store');
  });

  it('gives admin every key a lib-platform contract declares, and everyone their own account', async () => {
    const admin = (await sql<{ permission: string }>("select permission from radcore.role_grants where role = 'admin'")).map((r) => r.permission);
    const keys = [...new Set(declared.map((c) => c.perm).filter((k): k is string => k !== null))];
    expect(keys.filter((k) => !admin.includes(k))).toEqual([]);
    const without = await sql("select key from radcore.roles r where not exists (select 1 from radcore.role_grants g where g.role = r.key and g.permission = 'session:read') and key not like 't\\_%'");
    expect(without).toEqual([]);
  });

  it("loads a person as their role is now: its keys, the own-only ones, and nothing cached (RC-095)", async () => {
    const role = roleKey();
    await sql("insert into radcore.roles (key, name, description) values ($1, 'Test role', 'For roles.test.ts')", [role]);
    await sql("insert into radcore.role_grants (role, permission, scope) values ($1, 'session:read', 'all'), ($1, 'leads:read', 'own'), ($1, 'audit:read', 'all')", [role]);
    const id = await activePerson(role);
    expect(await load(`user:${id}`)).toEqual({ kind: 'user', userId: id, role, permissions: ['audit:read', 'leads:read', 'session:read'],
      ownScope: ['leads:read'] });
    // A grant changed now applies to the next request or job, in every process.
    await sql("update radcore.role_grants set scope = 'all' where role = $1 and permission = 'leads:read'", [role]);
    expect(await load(`user:${id}`)).toMatchObject({ ownScope: [] });
    await sql("delete from radcore.role_grants where role = $1 and permission = 'audit:read'", [role]);
    expect((await load(`user:${id}`))?.permissions).toEqual(['leads:read', 'session:read']);
  });

  it("loads nobody who is gone, disabled or not a person, and gives a role's keys and nothing more", async () => {
    // The plan's Store role holds only My work's key among M1's: nothing is added in code (ADR-001 §6a).
    const id = await activePerson('counter');
    expect((await load(`user:${id}`))?.permissions).toEqual(['session:read']);
    await sql("update radcore.users set status = 'disabled' where id = $1", [id]);
    expect(await load(`user:${id}`)).toBeNull();
    expect(await load(`user:${randomUUID()}`)).toBeNull();
    expect(await load('system:nightly')).toBeNull();
    expect(await load('user:not-an-id')).toBeNull();
  });

  it("answers not_found for a record outside the person's scope, as for no record at all (RAD-7)", async () => {
    const role = roleKey();
    await sql("insert into radcore.roles (key, name, description) values ($1, 'Test role', 'For roles.test.ts')", [role]);
    await sql("insert into radcore.role_grants (role, permission, scope) values ($1, 'session:read', 'all'), ($1, 'leads:read', 'own')", [role]);
    const id = await activePerson(role);
    const asha = await load(`user:${id}`);
    if (asha === null) throw new Error('the person did not load');
    await runInTransaction(db, write, asha, randomUUID(), async (ctx) => {
      expect(ctx.can('leads:read', { owner: `user:${id}` })).toBe(true);
      expect(ctx.can('leads:read', { owner: `user:${randomUUID()}` })).toBe(false);
      expect(() => ctx.see('leads:read', { owner: `user:${randomUUID()}` })).toThrow(expect.objectContaining({ code: 'not_found' }));
      expect(() => ctx.see('leads:read', { owner: `user:${id}` })).not.toThrow();
    });
  });

  it("asks the second factor of a person whose role needs it (D-19), and not of one whose role does not", async () => {
    const [admin, sales, counter] = [await activePerson('admin'), await activePerson('sales'), await activePerson('counter')];
    const needs = await runInTransaction(db, write, asTest, randomUUID(), async (ctx) =>
      Promise.all([admin, sales, counter].map((u) => roleNeedsSecondFactor(ctx, u))));
    expect(needs).toEqual([true, false, false]);
    // RAD-33's rule, through its own status: admin still has to enrol; sales and the counter staff sign in
    // without one (the auditor on #130).
    const status = await runInTransaction(db, write, asTest, randomUUID(), async (ctx) =>
      Promise.all([admin, sales, counter].map((u) => secondFactorStatus(ctx, u))));
    expect(status).toEqual(['enrolment_required', 'not_required', 'not_required']);
  });

  it('gives a person a new role and ends their sessions, so they sign in again under it', async () => {
    const id = await activePerson('sales');
    const token = createHash('sha256').update(randomUUID()).digest('hex');
    await sql(`insert into radcore.sessions (user_id, token_hash, device, idle_expires_at, absolute_expires_at)
      values ($1, $2, 'Chrome on Android', now() + interval '30 minutes', now() + interval '12 hours')`, [id, token]);
    await runInTransaction(db, write, asTest, randomUUID(), (ctx) => assignRole(ctx, id, 'accounts'));
    expect(await sql('select role from radcore.users where id = $1', [id])).toEqual([{ role: 'accounts' }]);
    expect(await sql('select ended_reason from radcore.sessions where user_id = $1', [id])).toEqual([{ ended_reason: 'role_changed' }]);
    await expect(runInTransaction(db, write, asTest, randomUUID(), (ctx) => assignRole(ctx, id, 'no_such_role')))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});
