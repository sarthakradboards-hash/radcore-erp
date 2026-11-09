// Vitest global setup: one fresh PostgreSQL database per test run, never one per test file (RC-005).
// With TEST_DATABASE_ADMIN_URL set (CI's PostgreSQL 16 service, or `npm run db:up` locally), it creates
// radcore_test_<random>, runs the migrations into it (`npm run db:migrate`, RAD-25), hands it to every test file
// as TEST_DATABASE_URL, and drops it when the run ends. Without it, database tests skip.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const admin = (url: string) => new pg.Client({ connectionString: url });

export default async function setup() {
  const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
  if (!adminUrl) return undefined;
  // The name is ours, from random hex, so it can be written into the statement; identifiers can't be bound.
  const name = `radcore_test_${randomBytes(16).toString('hex')}`;
  const client = admin(adminUrl);
  await client.connect();
  await client.query(`create database ${name}`);
  await client.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  // Workers start after global setup, so they inherit this.
  process.env['TEST_DATABASE_URL'] = url.toString();

  const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  if (scripts['db:migrate']) {
    const r = spawnSync('npm run db:migrate', { stdio: 'inherit', shell: true, env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() } });
    if (r.status !== 0) throw new Error('db:migrate failed on the fresh test database');
  }

  return async () => {
    const c = admin(adminUrl);
    await c.connect();
    await c.query(`drop database if exists ${name} with (force)`);
    await c.end();
  };
}
