// RAD-119 (the architect's ruling; Sarthak's "keep it dynamic"): receivables:read and receivables:remind are ordinary
// catalogue keys, held to no role, with no second factor (they move no money). The migration's grants (admin, owner
// and accounts) are only where the roles start: an owner gives the sales role either on the roles screen and takes it
// away again, each step seen by the database, inside a transaction that rolls back.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, roleGrants } from '@radcore/db/platform';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
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
const KEYS = ['receivables:read', 'receivables:remind'];

class Rollback extends Error {}

it('declares the receivables keys as ordinary catalogue keys, held to no role, with no second factor', () => {
  expect(PERMISSIONS.filter((p) => KEYS.includes(p.key)).map((p) => [p.key, p.onlyRoles, p.allOnly])).toEqual(KEYS.map((k) => [k, undefined, undefined]));
  expect(KEYS.map((k) => SECOND_FACTOR_KEYS.includes(k))).toEqual([false, false]);
});

describe.skipIf(!url || !superUrl)('the receivables keys on the roles screen', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  it('starts admin, owner and accounts with both, and no other role', async () => {
    const rows = await su.query<{ role: string; permission: string }>(`select role, permission from radcore.role_templates
      where permission = any($1) order by permission, role`, [KEYS]);
    expect(rows.rows.map((r) => `${r.permission} ${r.role}`)).toEqual(KEYS.flatMap((k) => ['accounts', 'admin', 'owner'].map((r) => `${k} ${r}`)));
  });

  // The sales role starts with neither key (the migrations' grants: admin, owner and accounts).
  it.each(KEYS)('lets an owner give the sales role %s, and take it away again', async (key) => {
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
        version: (await permissionMatrix(ctx)).version, reason: `Sales chases payments: ${key}` });
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
