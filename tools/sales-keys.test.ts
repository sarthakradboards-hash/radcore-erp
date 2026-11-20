// RAD-112 (Sarthak, 20 Nov: the sales keys stay "changeable like dynamic", "by owner and admin"): sales:read, sales:write
// and sales:override are ordinary catalogue keys, with no role they're held to, and the migration's grants are only
// where the roles start. An owner gives a role sales:override on the roles screen and takes it away again, each step
// seen by the database. Done inside transactions that roll back, so the shared database's grants stay as shipped.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, roleGrants } from '@radcore/db/platform';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import { permissionMatrix, setRoleGrants } from '../packages/lib-platform/src/auth/roles-admin.ts';
import { PERMISSIONS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
const SALES_KEYS = ['sales:read', 'sales:write', 'sales:override'];
class Rollback extends Error {}

it('declares the sales keys as ordinary catalogue keys, held to no role', () => {
  const keys = PERMISSIONS.filter((p) => SALES_KEYS.includes(p.key));
  expect(keys.map((p) => [p.key, p.onlyRoles, p.allOnly])).toEqual(SALES_KEYS.map((k) => [k, undefined, undefined]));
});

describe.skipIf(!url || !superUrl)('the sales keys on the roles screen', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  it('lets an owner give a role sales:override, and take it away again', async () => {
    const { rows: [user] } = await su.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Owner', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now(), 'owner') returning id`,
    [`owner.${randomBytes(3).toString('hex')}@example.in`]);
    const owner = (await runInTransaction(db, WRITE, SYSTEM, randomUUID(), (ctx) => principalFor(ctx, user?.id ?? ''))) ?? SYSTEM;
    const seen = { granted: false, revoked: true };
    const held = (ctx: Ctx) => platformTx(ctx).select({ p: roleGrants.permission }).from(roleGrants).where(eq(roleGrants.role, 'sales'))
      .then((rows) => rows.map((g) => g.p));
    const both = () => runInTransaction(db, WRITE, owner, randomUUID(), async (ctx: Ctx) => {
      const before = await held(ctx);
      const given = await setRoleGrants(ctx, { key: 'sales', grants: [...before, 'sales:override'].toSorted(),
        version: (await permissionMatrix(ctx)).version, reason: 'The sales lead approves overrides' });
      seen.granted = (await held(ctx)).includes('sales:override');
      await setRoleGrants(ctx, { key: 'sales', grants: before.filter((k) => k !== 'sales:override').toSorted(), version: given.version,
        reason: 'Back to the starting grants' });
      seen.revoked = !(await held(ctx)).includes('sales:override');
      throw new Rollback();
    }).catch((e: unknown) => e);
    // Another file may change the matrix between the read and the write (as in roles-admin.test.ts, #160): retry.
    let done = await both();
    for (let i = 0; i < 5 && done instanceof AppError && done.code === 'matrix_changed'; i++) done = await both();
    expect([done instanceof Rollback, seen.granted, seen.revoked]).toEqual([true, true, true]);
  });
});
