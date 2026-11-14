// RAD-88 (M2-02, D-02 option A): the company profile on a real PostgreSQL. RadCore keeps one legal entity's books: the
// database refuses a second company (RC-010), and nothing is invoiced until the GSTIN, address and state are set,
// the state being the GSTIN's own, never a default (RC-112). The profile is one row every test would share, so each
// test runs in a transaction that is rolled back, and leaves no company behind for another file or test.
import { randomBytes, randomUUID } from 'node:crypto';
import { companyForInvoice, getCompanyProfile, setCompanyProfile } from '@radcore/lib-accounts';
import { AppError, roleNeedsSecondFactor, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const fields = {
  legalName: 'Radboards Pvt Ltd', gstin: '29AAPFU0939F1ZR', addressLine1: 'Plot 4, Peenya', addressLine2: null,
  city: 'Bengaluru', pincode: '560058',
};
const profile = { ...fields, reason: 'Setting up the books' };

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the company tests must run, not skip');
});

// D-19 widened (Sarthak, 15 Nov): the company profile sets the tax identity every invoice prints.
it('marks company:write as a key that needs the second factor, and company:read not', () => {
  expect([SECOND_FACTOR_KEYS.includes('company:write'), SECOND_FACTOR_KEYS.includes('company:read')]).toEqual([true, false]);
});

class RolledBack extends Error {}

describe.skipIf(!url)('the company profile', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const superPool = new pg.Pool({ connectionString: superUrl, max: 1 });
  afterAll(async () => { await Promise.all([pool.end(), superPool.end()]); });

  /** Runs `fn` in a transaction that is always rolled back, and answers what it answered. */
  async function rolledBack<R>(fn: (ctx: Ctx) => Promise<R>): Promise<R> {
    let out: R | undefined;
    await runInTransaction(db, write, AS, randomUUID(), async (ctx) => {
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => { if (!(e instanceof RolledBack)) throw e; });
    return out as R;
  }
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  it('asks the second factor of someone whose role holds company:write, whatever the role says (D-19)', async () => {
    const role = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await superPool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query("insert into radcore.roles (key, name, description) values ($1, $1, 'For company.test.ts')", [role]);
      await c.query("insert into radcore.role_grants (role, permission, scope) values ($1, 'session:read', 'all'), ($1, 'company:write', 'all')", [role]);
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash, role)
        values ($1, 'Test', 'active', 'x', $2) returning id`, [`company.${randomUUID()}@example.test`, role]);
      await c.query('commit');
      const id = rows[0]?.id ?? '';
      expect(await runInTransaction(db, write, AS, randomUUID(), (ctx) => roleNeedsSecondFactor(ctx, id))).toBe(true);
    } finally {
      c.release();
    }
  });

  it('refuses to invoice before the profile is set, and has no state to fall back on (RC-112)', async () => {
    expect(await rolledBack(async (ctx) => [await getCompanyProfile(ctx), await code(companyForInvoice(ctx))]))
      .toEqual([{ company: null }, 'company_profile_incomplete']);
  });

  it('takes the state from the GSTIN, and invoices once the profile is set', async () => {
    const [set, seller] = await rolledBack(async (ctx) => [await setCompanyProfile(ctx, profile), await companyForInvoice(ctx)]);
    expect([set, seller]).toEqual([{ stateCode: '29' }, { ...fields, stateCode: '29' }]);
  });

  it('changes the one company when set again, and never adds another (RC-010)', async () => {
    const after = await rolledBack(async (ctx) => {
      await setCompanyProfile(ctx, profile);
      await setCompanyProfile(ctx, { ...profile, gstin: '27AAPFU0939F1ZV', city: 'Pune', pincode: '411019' });
      return getCompanyProfile(ctx);
    });
    expect([after.company?.stateCode, after.company?.city]).toEqual(['27', 'Pune']);
  });

  it('refuses a second company, a made-up state or a bad GSTIN in the database itself, whoever writes', async () => {
    const c = await superPool.connect();
    const tryInsert = async (sql: string) => {
      await c.query('begin');
      try {
        await c.query("set local app.principal = 'system:test'");
        await c.query(sql);
        return 'ok';
      } catch (e) {
        return (e as { constraint?: string }).constraint ?? String(e);
      } finally {
        await c.query('rollback');
      }
    };
    const cols = "(legal_name, gstin, address_line1, city, pincode)";
    const vals = "'Radboards Pvt Ltd', '29AAPFU0939F1ZR', 'Plot 4', 'Bengaluru', '560058'";
    try {
      expect(await tryInsert(`insert into radcore.company (id, legal_name, gstin, address_line1, city, pincode) values (2, ${vals})`))
        .toBe('ck_company_one');
      expect(await tryInsert(`insert into radcore.company ${cols} values (${vals}), (${vals})`)).toBe('company_pkey');
      expect(await tryInsert(`insert into radcore.company (state_code, legal_name, gstin, address_line1, city, pincode) values ('27', ${vals})`))
        .toMatch(/generated|state_code/i);
      expect(await tryInsert(`insert into radcore.company ${cols} values ('Radboards', 'NOT-A-GSTIN', 'Plot 4', 'Pune', '411019')`))
        .toBe('ck_company_gstin');
      expect(await tryInsert(`insert into radcore.company ${cols} values (${vals})`)).toBe('ok');
    } finally {
      c.release();
    }
  });
});
