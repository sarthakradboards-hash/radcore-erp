// Vitest global setup: one fresh PostgreSQL database per test run, never one per test file (RC-005).
// With TEST_DATABASE_ADMIN_URL set (CI's PostgreSQL 16 service, or `npm run db:up` locally), it creates
// radcore_test_<random>, makes the three logins and gives the owner the database (RAD-24), runs the migrations into it
// as the owner (`npm run db:migrate`, RAD-25), and drops it when the run ends. Without it, database tests skip.
// Each login is the admin session narrowed with `-c role=`, so no password is needed:
// - TEST_DATABASE_URL: the runtime login radcore_app, what the api and worker run as;
// - TEST_DATABASE_OWNER_URL: the owner, for a test that makes its own tables or views;
// - TEST_DATABASE_SUPERUSER_URL: the admin itself, for a test that switches between the logins.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { series as accountsSeries } from '@radcore/lib-accounts';
import { series as platformSeries } from '@radcore/lib-platform';
import { series as salesSeries } from '@radcore/lib-sales';
import { series as stockSeries } from '@radcore/lib-stock';
import { ensureLogins } from './db-logins.ts';

const admin = (url: string) => new pg.Client({ connectionString: url });

/** A fresh database, its logins and its migrations, and how to drop it: the run's own, or one for a test whose
 * processes must not share the run's (a real worker's outbox relay takes every due row in its database, RAD-79). */
export async function freshDatabase(adminUrl: string): Promise<{ appUrl: string; ownerUrl: string; superUrl: string; drop(): Promise<void> }> {
  // The name is ours, from random hex, so it can be written into the statement; identifiers can't be bound.
  const name = `radcore_test_${randomBytes(16).toString('hex')}`;
  const client = admin(adminUrl);
  await client.connect();
  await client.query(`create database ${name}`);
  await client.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const as = (login: string) => {
    const u = new URL(url);
    u.searchParams.set('options', `-c role=${login}`);
    return u.toString();
  };
  await ensureLogins(url.toString());
  const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  if (scripts['db:migrate']) {
    const r = spawnSync('npm run db:migrate', { stdio: 'inherit', shell: true, env: { ...process.env, MIGRATION_DATABASE_URL: as('radcore_owner') } });
    if (r.status !== 0) throw new Error('db:migrate failed on the fresh test database');
  }
  return {
    appUrl: as('radcore_app'), ownerUrl: as('radcore_owner'), superUrl: url.toString(),
    drop: async () => {
      const c = admin(adminUrl);
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

/** The run's one company profile, committed (the architect on RAD-112): in Maharashtra (27), as the tests' parties
 * mostly are. company.test.ts proves the unset profile by deleting it in a transaction that rolls back. With it, every
 * real series' number counter for the tests' years (RAD-76). */
async function seedCompany(superUrl: string): Promise<void> {
  const c = admin(superUrl);
  await c.connect();
  try {
    await c.query('begin');
    await c.query("set local app.principal = 'system:test'");
    await c.query(`insert into radcore.company (legal_name, gstin, address_line1, city, pincode)
      values ('Radboards Pvt Ltd', '27AAPFU0939F1ZV', 'Plot 4, Bhosari MIDC', 'Pune', '411019')`);
    // Every real series' counter for the years the tests post in, committed (RAD-76). Rolled-back test transactions
    // otherwise each insert the same uncommitted counter rows, and two inserts of one key wait on each other's
    // transaction: a deadlock whenever two of them draw two series in opposite orders. Committed, a draw is a row lock,
    // taken journal first by every posting. Each seed uses the year's number 1, so committed documents start at 2.
    const keys = [...accountsSeries, ...platformSeries, ...salesSeries, ...stockSeries];
    await c.query(`insert into radcore.number_counters (series, financial_year, prefix)
      select s.key, y, s.prefix from unnest($1::text[], $2::text[]) as s(key, prefix), unnest(array['2025-26', '2026-27']) as y`,
    [keys.map((k) => k.key), keys.map((k) => k.prefix)]);
    await c.query('commit');
  } finally {
    await c.end();
  }
}

export default async function setup() {
  const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
  if (!adminUrl) return undefined;
  const db = await freshDatabase(adminUrl);
  await seedCompany(db.superUrl);
  // Workers start after global setup, so they inherit these.
  process.env['TEST_DATABASE_URL'] = db.appUrl;
  process.env['TEST_DATABASE_OWNER_URL'] = db.ownerUrl;
  process.env['TEST_DATABASE_SUPERUSER_URL'] = db.superUrl;
  return db.drop;
}
