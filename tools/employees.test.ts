// RAD-92 (M2-14, ADR-005 §3 to §5 and §7c, RAD-40) on a real PostgreSQL, as the runtime login: the employee master over
// real HTTP. A code is unique whatever its case or spacing; a phone is kept in E.164 and an email in lower case; the
// phone and email reach a screen masked without pii:read, and each record shown unmasked is logged as a look; the audit
// redacts both; an employee is switched off, never deleted; and the new keys are ordinary ones an owner can grant
// (Sarthak, 15 Nov). Each test makes codes of its own, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, roleGrants } from '@radcore/db/platform';
import { loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import hr from '../apps/api/src/routes/hr.ts';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import { permissionMatrix, setRoleGrants } from '../packages/lib-platform/src/auth/roles-admin.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const HR_PERSON = '00000000-0000-4000-8000-000000000093';
const hrStaff = (pii: boolean): Principal => ({ kind: 'user', userId: HR_PERSON,
  permissions: ['employees:read', 'employees:write', ...(pii ? ['pii:read'] : [])] });
class Rollback extends Error {}

describe.skipIf(!url || !superUrl)('the employee master', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  // A server with hr's routes, signed in as `principal`.
  async function serve<T>(principal: Principal, fn: (call: (method: string, path: string, body?: object) =>
    Promise<{ status: number; body: Record<string, unknown> }>) => Promise<T>): Promise<T> {
    const app = createApp(config(), { info: () => undefined, error: () => undefined }, { db, authenticate: async () => principal,
      routes: hr });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      return await fn(async (method, path, body) => {
        const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, ...(body === undefined ? {} : {
          body: JSON.stringify(body) }), headers: { 'content-type': 'application/json', origin: ORIGIN,
          ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) } });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      });
    } finally {
      await server.stop();
    }
  }
  // A GET's input is one JSON `input` parameter (the handler's readInput).
  const list = (search: string, status?: 'active' | 'inactive') => `/hr/employees?input=${encodeURIComponent(JSON.stringify(
    { filter: { search, ...(status === undefined ? {} : { status }) }, limit: 10 }))}`;

  it('adds an employee, keeps the phone in E.164 and the email in lower case, and refuses the same code again', async () => {
    const code = `E-${tag()}`;
    await serve(hrStaff(true), async (call) => {
      const added = await call('POST', '/hr/employees', { code, name: 'Asha Rao', phone: '098765 43210',
        email: 'Asha.Rao@Example.IN', designation: 'Stores keeper', joinedOn: '2026-04-01' });
      expect(added.status).toBe(200);
      const again = await call('POST', '/hr/employees', { code: ` ${code.toLowerCase()} `, name: 'Another' });
      expect([again.status, again.body['code']]).toEqual([422, 'code_taken']);
      const { body } = await call('GET', list(code));
      expect(body['items']).toEqual([{ id: added.body['id'], code, name: 'Asha Rao', phone: '+919876543210',
        email: 'asha.rao@example.in', designation: 'Stores keeper', joinedOn: '2026-04-01', active: true }]);
    });
  });

  // RAD-40: masked without pii:read, a look logged per record shown unmasked.
  it('masks the phone to its last 4 and the email whole without pii:read, and logs a look only when shown', async () => {
    const code = `M-${tag()}`;
    const id = await serve(hrStaff(true), async (call) => (await call('POST', '/hr/employees',
      { code, name: 'Ravi Kumar', phone: '+91 91234 56789', email: 'ravi@example.in' })).body['id'] as string);
    const masked = await serve(hrStaff(false), async (call) => (await call('GET', list(code))).body['items']);
    expect(masked).toEqual([expect.objectContaining({ phone: { masked: '••••••6789' }, email: { masked: '••••••' } })]);
    const looks = async () => Number((await su.query("select count(*) from radcore.access_log where record_table = 'employees' and record_id = $1",
      [id])).rows[0]?.count);
    expect(await looks()).toBe(0);
    await serve(hrStaff(true), async (call) => call('GET', list(code)));
    expect(await looks()).toBe(1);
  });

  it('changes and clears details, switches an employee off, redacts contact details in the audit, and never deletes', async () => {
    const code = `U-${tag()}`;
    await serve(hrStaff(true), async (call) => {
      const id = (await call('POST', '/hr/employees', { code, name: 'Neha', phone: '9876500000', email: 'neha@example.in' })).body['id'];
      expect((await call('PATCH', `/hr/employees/${String(id)}`, { id, name: 'Neha S', email: null, active: false })).status).toBe(200);
      const { body } = await call('GET', list(code, 'inactive'));
      expect(body['items']).toEqual([expect.objectContaining({ name: 'Neha S', phone: '+919876500000', email: null, active: false })]);
      const missing = await call('PATCH', '/hr/employees/00000000-0000-4000-8000-0000000000ff', { id: '00000000-0000-4000-8000-0000000000ff', name: 'x' });
      expect(missing.status).toBe(404);
      const { rows } = await su.query<{ changed: string }>(
        "select changed::text from radcore.audit_log where table_name = 'employees' and record_id = $1 order by seq", [id]);
      expect(rows.map((r) => r.changed).join('\n')).not.toMatch(/9876500000|neha@example/);
      await expect(pool.query('delete from radcore.employees where id = $1', [id])).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('grants the starting keys from the plan, and none of them is held back to named roles', async () => {
    const { rows } = await su.query<{ grant: string }>(`select permission || ' ' || role as grant from radcore.role_grants
      where permission in ('employees:read', 'employees:write', 'cost:read') order by permission, role`);
    expect(rows.map((r) => r.grant)).toEqual([
      ...['accounts', 'admin', 'owner', 'stores'].map((r) => `cost:read ${r}`),
      ...['accounts', 'admin', 'hr', 'operations', 'owner', 'service_head'].map((r) => `employees:read ${r}`),
      ...['admin', 'hr'].map((r) => `employees:write ${r}`)]);
  });

  // Sarthak, 15 Nov: the new keys stay dynamic, so an owner gives the service manager cost:read on the role screen. Done
  // inside a transaction that's rolled back, so the shared database's grants stay as shipped for the other files.
  it('lets an owner grant cost:read to the service manager role', async () => {
    const [user] = (await su.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Owner', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now(), 'owner') returning id`,
    [`owner.${tag().toLowerCase()}@example.in`])).rows;
    const owner = (await runInTransaction(db, WRITE, SYSTEM, randomUUID(), (ctx) => principalFor(ctx, user?.id ?? ''))) ?? SYSTEM;
    const seen = { grants: [] as string[] };
    const done = await runInTransaction(db, WRITE, owner, randomUUID(), async (ctx: Ctx) => {
      const { version } = await permissionMatrix(ctx);
      const held = (await platformTx(ctx).select({ p: roleGrants.permission }).from(roleGrants)
        .where(eq(roleGrants.role, 'service_head'))).map((g) => g.p);
      await setRoleGrants(ctx, { key: 'service_head', grants: [...held, 'cost:read'].toSorted(), version,
        reason: 'The service manager prices parts' });
      seen.grants = (await platformTx(ctx).select({ p: roleGrants.permission }).from(roleGrants)
        .where(eq(roleGrants.role, 'service_head'))).map((g) => g.p);
      throw new Rollback();
    }).catch((e: unknown) => e);
    expect(done).toBeInstanceOf(Rollback);
    expect(seen.grants).toContain('cost:read');
    const after = await su.query("select 1 from radcore.role_grants where role = 'service_head' and permission = 'cost:read'");
    expect(after.rowCount).toBe(0);
  });
});
