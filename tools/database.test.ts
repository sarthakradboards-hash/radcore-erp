// The test database is production's major version (RC-154) and fresh for this run (RC-005). Runs where
// TEST_DATABASE_ADMIN_URL is set: CI's PostgreSQL 16 service, or locally after `npm run db:up`.
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];

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
      // No migrations exist until RAD-25; then this counts what they create from empty.
      expect(Number(row?.tables)).toBe(0);
    } finally {
      await client.end();
    }
  });
});
