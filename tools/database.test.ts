// The test database is production's major version (RC-154) and fresh for this run (RC-005). Runs where
// TEST_DATABASE_ADMIN_URL is set: CI's PostgreSQL 16 service, or locally after `npm run db:up`. In CI it fails
// instead of skipping, so the proof can't drop out quietly (RC-019).
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the database tests must run, not skip');
});

describe.skipIf(!url)('test database', () => {
  it('is PostgreSQL 16, created for this run, and holds only what the migrations made', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ version: string; name: string; tables: string }>(
        `select current_setting('server_version_num') as version, current_database() as name,
                (select count(*) from information_schema.tables where table_schema = 'public') as tables`);
      const row = rows[0];
      expect(Number(row?.version) / 10000 | 0).toBe(16);
      expect(row?.name).toMatch(/^radcore_test_[0-9a-f]{32}$/);
      // The migrations ran (RAD-25), and every table they make is in `radcore` (ADR-005 §7c), so `public` stays empty.
      expect(Number(row?.tables)).toBe(0);
    } finally {
      await client.end();
    }
  });
});
