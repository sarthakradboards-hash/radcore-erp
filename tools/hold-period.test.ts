// ADR-006 §1 step 1 (the architect on RAD-113): every posting holds the company profile FOR SHARE with the period lock,
// through holdPeriod, so a change to the profile waits for the postings in flight and the GSTIN and state an invoice
// freezes can't change under it. The run's profile is committed (tools/test-database.ts) and other files hold it FOR
// SHARE as they post, so this test deletes it and sets its own in a superuser transaction that rolls back (as
// company.test.ts does): only it sees that row, and xmax names this transaction once it holds it FOR SHARE, 0 before.
import { randomUUID } from 'node:crypto';
import { accountsTx, company } from '@radcore/db/accounts';
import { holdPeriod, openFinancialYear, setCompanyProfile } from '@radcore/lib-accounts';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { rawOf } from '../packages/db/src/tx.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const DAY = '2026-11-10';

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the period-hold tests must run, not skip');
});

class RolledBack extends Error {}

describe.skipIf(!url)('holdPeriod', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const superPool = new pg.Pool({ connectionString: superUrl, max: 1 });
  const superDb = createDatabase(superPool);
  afterAll(async () => { await Promise.all([pool.end(), superPool.end()]); });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, AS, randomUUID(), fn);

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  it('holds the company profile FOR SHARE, so a change to it waits for the postings in flight', async () => {
    const locker = (ctx: Ctx) => accountsTx(ctx).select({ mine: sql<boolean>`xmax::text = (txid_current() % 4294967296)::text` }).from(company)
      .then((r) => r[0]?.mine);
    let seen: (boolean | undefined)[] = [];
    await runInTransaction(superDb, { readOnly: false, isolation: 'read committed' }, AS, randomUUID(), async (ctx) => {
      await rawOf(ctx.tx).execute(sql`delete from radcore.company`);
      await setCompanyProfile(ctx, { legalName: 'Radboards Pvt Ltd', gstin: '29AAPFU0939F1ZR', addressLine1: 'Plot 4, Peenya',
        addressLine2: null, city: 'Bengaluru', pincode: '560058', reason: 'Setting up the books' });
      const before = await locker(ctx);
      await holdPeriod(ctx, DAY);
      seen = [before, await locker(ctx)];
      throw new RolledBack();
    }).catch((e: unknown) => { if (!(e instanceof RolledBack)) throw e; });
    expect(seen).toEqual([false, true]);
  });
});
