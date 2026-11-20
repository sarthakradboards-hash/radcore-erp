// RAD-112 (Sarthak, 20 Nov: the sales keys stay "changeable like dynamic", "by owner and admin"): sales:read, sales:write,
// sales:override and deliveries:write are ordinary catalogue keys, with no role they're held to, and the migrations'
// grants are only where the roles start. An owner gives a role sales:override, or deliveries:write, on the roles screen
// and takes it away again, each step seen by the database. Done inside transactions that roll back, so the shared database's grants stay as shipped.
// An override lets a sale past its checks, so a role holding sales:override needs the second factor (D-19, Sarthak on
// 20 Nov), as prices:approve does: without it, its holder can't sign in to approve one.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, roleGrants } from '@radcore/db/platform';
import { AppError, roleNeedsSecondFactor, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import { permissionMatrix, setRoleGrants } from '../packages/lib-platform/src/auth/roles-admin.ts';
import { PERMISSIONS, SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
// In the catalogue's order.
const SALES_KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'sales:override'];
class Rollback extends Error {}

it('declares the sales keys as ordinary catalogue keys, held to no role', () => {
  const keys = PERMISSIONS.filter((p) => SALES_KEYS.includes(p.key));
  expect(keys.map((p) => [p.key, p.onlyRoles, p.allOnly])).toEqual(SALES_KEYS.map((k) => [k, undefined, undefined]));
});

it('marks sales:override as a key that needs the second factor, and the others not', () => {
  expect(SALES_KEYS.map((k) => SECOND_FACTOR_KEYS.includes(k))).toEqual([false, false, false, true]);
});

describe.skipIf(!url || !superUrl)('the sales keys on the roles screen', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  it('asks the second factor of someone whose role holds sales:override, whatever the role says (D-19)', async () => {
    const role = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query("insert into radcore.roles (key, name, description) values ($1, $1, 'For sales-keys.test.ts')", [role]);
      await c.query("insert into radcore.role_grants (role, permission, scope) values ($1, 'session:read', 'all'), ($1, 'sales:override', 'all')", [role]);
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash, role)
        values ($1, 'Test', 'active', 'x', $2) returning id`, [`sales.${randomUUID()}@example.test`, role]);
      await c.query('commit');
      expect(await runInTransaction(db, WRITE, SYSTEM, randomUUID(), (ctx) => roleNeedsSecondFactor(ctx, rows[0]?.id ?? ''))).toBe(true);
    } finally {
      c.release();
    }
  });

  // The sales role starts with neither key (the migrations' grants).
  it.each(['sales:override', 'deliveries:write'])('lets an owner give a role %s, and take it away again', async (key) => {
    // As a named system principal, as every write needs one (RA005).
    const { rows: [user] } = await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, status, password_hash, password_set_at, role)
      select $1, 'Owner', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now(), 'owner' from p returning id`,
    [`owner.${randomBytes(3).toString('hex')}@example.in`]);
    const owner = (await runInTransaction(db, WRITE, SYSTEM, randomUUID(), (ctx) => principalFor(ctx, user?.id ?? ''))) ?? SYSTEM;
    const seen = { granted: false, revoked: true };
    const held = (ctx: Ctx) => platformTx(ctx).select({ p: roleGrants.permission }).from(roleGrants).where(eq(roleGrants.role, 'sales'))
      .then((rows) => rows.map((g) => g.p));
    const both = () => runInTransaction(db, WRITE, owner, randomUUID(), async (ctx: Ctx) => {
      const before = await held(ctx);
      const given = await setRoleGrants(ctx, { key: 'sales', grants: [...before, key].toSorted(),
        version: (await permissionMatrix(ctx)).version, reason: `The sales lead is given ${key}` });
      seen.granted = (await held(ctx)).includes(key);
      await setRoleGrants(ctx, { key: 'sales', grants: before.filter((k) => k !== key).toSorted(), version: given.version,
        reason: 'Back to the starting grants' });
      seen.revoked = !(await held(ctx)).includes(key);
      throw new Rollback();
    }).catch((e: unknown) => e);
    // Another file may change the matrix between the read and the write (as in roles-admin.test.ts, #160): retry.
    let done = await both();
    for (let i = 0; i < 5 && done instanceof AppError && done.code === 'matrix_changed'; i++) done = await both();
    expect([done instanceof Rollback, seen.granted, seen.revoked]).toEqual([true, true, true]);
  });
});
