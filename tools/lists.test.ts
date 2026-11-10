// M1-29's list conditions (packages/db/src/lists.ts): the SQL they build, and on a real PostgreSQL 16 that a search
// finds what it says (RC-203), a date filter is served by its index (RC-202), and keyset pages cover every row once.
// The fixture table is made by the owner login inside one transaction that is rolled back; this Drizzle declaration
// only builds the queries.
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { date, PgDialect, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trigramIndex } from '../packages/db/src/columns.ts';
import { after, escapeLike, onDates, onIndiaDays, searchWords } from '../packages/db/src/lists.ts';

const fixture = pgSchema('list_fixture');
const entries = fixture.table('entries', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  note: text().notNull().default(''),
  entryDate: date('entry_date').notNull(),
  at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

const dialect = new PgDialect();
const show = (cond: ReturnType<typeof onDates>) => {
  if (cond === undefined) return undefined;
  const { sql, params } = dialect.sqlToQuery(cond);
  return { sql, params };
};

describe('the SQL each condition builds', () => {
  it('escapes LIKE\'s own characters in a search (RC-203)', () => {
    expect(escapeLike('50% off a_b c\\d')).toBe('50\\% off a\\_b c\\\\d');
    expect(show(searchWords([entries.name, entries.note], ' 50%  a_b ')))
      .toEqual({ sql: '(("list_fixture"."entries"."name" ilike $1 or "list_fixture"."entries"."note" ilike $2) and '
        + '("list_fixture"."entries"."name" ilike $3 or "list_fixture"."entries"."note" ilike $4))',
      params: ['%50\\%%', '%50\\%%', '%a\\_b%', '%a\\_b%'] });
  });

  it('adds nothing for a blank search or an empty date range', () => {
    expect(searchWords([entries.name], '   ')).toBeUndefined();
    expect(searchWords([entries.name], undefined)).toBeUndefined();
    expect(onDates(entries.entryDate, {})).toBeUndefined();
    expect(after([entries.entryDate, entries.id], undefined, 'desc')).toBeUndefined();
  });

  it('compares the date column as it is, never a function of it (RC-202)', () => {
    expect(show(onDates(entries.entryDate, { from: '2026-04-01', to: '2026-04-30' }))).toEqual({
      sql: '("list_fixture"."entries"."entry_date" >= $1 and "list_fixture"."entries"."entry_date" <= $2)',
      params: ['2026-04-01', '2026-04-30'] });
  });

  it('turns India dates into moments for a timestamp column, both days included', () => {
    expect(show(onIndiaDays(entries.at, { from: '2026-11-07', to: '2026-11-07' }))).toEqual({
      sql: '("list_fixture"."entries"."at" >= $1 and "list_fixture"."entries"."at" < $2)',
      params: ['2026-11-06T18:30:00.000Z', '2026-11-07T18:30:00.000Z'] });
  });

  it('starts a newest-first page strictly after the last row\'s sort key', () => {
    expect(show(after([entries.entryDate, entries.id], ['2026-04-02', 'b'], 'desc'))).toEqual({
      sql: '("list_fixture"."entries"."entry_date" < $1 or ("list_fixture"."entries"."entry_date" = $2 and '
        + '"list_fixture"."entries"."id" < $3))',
      params: ['2026-04-02', '2026-04-02', 'b'] });
    expect(() => after([entries.entryDate, entries.id], ['2026-04-02'], 'desc')).toThrow(TypeError);
    // auditor-2 SHOULD on #69: `col < null` is never true, so a null key value would end the list early.
    expect(() => after([entries.entryDate, entries.id], [null, 'b'], 'desc')).toThrow(/no null/);
  });
});

const url = process.env['TEST_DATABASE_OWNER_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_OWNER_URL is not set: in CI the list tests must run, not skip');
});

describe.skipIf(!url)('list conditions on PostgreSQL', () => {
  const client = new pg.Client({ connectionString: url });
  const db = drizzle({ client });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    await client.connect();
    await client.query('begin');
    await client.query('create schema list_fixture');
    await client.query(`create table list_fixture.entries (id uuid primary key, name text not null,
      note text not null default '', entry_date date not null, at timestamptz not null default now())`);
    await client.query('create index ix_entries_date_id on list_fixture.entries (entry_date desc, id desc)');
    // Eleven rows over five dates, three on one date, so paging crosses ties.
    const names = ['50% off', '500 off', 'a_b', 'axb', 'Asha Motors', 'asha traders', 'Ravi', 'Tea', 'Fuel', 'Rent', 'Misc'];
    for (const [i, name] of names.entries()) {
      await client.query('insert into list_fixture.entries (id, name, entry_date) values ($1, $2, $3)',
        [id(i + 1), name, `2026-04-0${String(1 + (i % 5))}`]);
    }
    await client.query('analyze list_fixture.entries');
  });

  afterAll(async () => {
    await client.query('rollback');
    await client.end();
  });

  const names = async (cond: ReturnType<typeof searchWords>) =>
    (await db.select({ name: entries.name }).from(entries).where(cond)).map((r) => r.name).sort();

  it('finds "50%" and "a_b" as written, not as wildcards (RC-203)', async () => {
    expect(await names(searchWords([entries.name], '50%'))).toEqual(['50% off']);
    expect(await names(searchWords([entries.name], 'a_b'))).toEqual(['a_b']);
    expect(await names(searchWords([entries.name], 'ASHA'))).toEqual(['Asha Motors', 'asha traders']);
    expect(await names(searchWords([entries.name], 'asha mot'))).toEqual(['Asha Motors']);
  });

  it('serves a date range from the date index, not by converting every row (RC-202)', async () => {
    await client.query('savepoint plan');
    try {
      await client.query('set local enable_seqscan = off');
      const q = db.select({ id: entries.id }).from(entries)
        .where(onDates(entries.entryDate, { from: '2026-04-02', to: '2026-04-03' })).toSQL();
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`explain ${q.sql}`, q.params);
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/Index (Only )?Scan using ix_entries_date_id|Bitmap Index Scan on ix_entries_date_id/);
      expect(plan).not.toMatch(/Seq Scan/);
    } finally {
      await client.query('rollback to savepoint plan');
    }
  });

  it('pages newest first through every row once, across ties on the date', async () => {
    const seen: string[] = [];
    let cursor: [string, string] | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const rows = await db.select({ id: entries.id, entryDate: entries.entryDate }).from(entries)
        .where(after([entries.entryDate, entries.id], cursor, 'desc'))
        .orderBy(desc(entries.entryDate), desc(entries.id)).limit(3 + 1);
      const page = rows.slice(0, 3);
      seen.push(...page.map((r) => r.id));
      const last = page.at(-1);
      if (rows.length <= 3 || !last) break;
      cursor = [last.entryDate, last.id];
    }
    const all = await db.select({ id: entries.id, entryDate: entries.entryDate }).from(entries);
    const order = all.sort((a, b) => (a.entryDate === b.entryDate ? b.id.localeCompare(a.id) : b.entryDate.localeCompare(a.entryDate)));
    expect(seen).toEqual(order.map((r) => r.id));
  });
});

// RC-160: a search's ILIKE '%…%' served by a trigram index. pg_trgm is in radcore_ext (ADR-005 §7c, migration
// 0005_pg_trgm), where neither login has USAGE; the index works without it.
const trgm = pgSchema('trgm_fixture');
const parties = trgm.table('parties', { id: uuid().primaryKey(), name: text().notNull() },
  (t) => [trigramIndex('ix_parties_name_trgm', t.name)]);
const ddl = async () => generateMigration(generateDrizzleJson({}), generateDrizzleJson({ trgm, parties }, undefined, undefined, 'snake_case'));

it("writes the trigram index with radcore_ext's operator class", async () => {
  expect(await ddl()).toContain(
    'CREATE INDEX "ix_parties_name_trgm" ON "trgm_fixture"."parties" USING gin ("name" radcore_ext.gin_trgm_ops);');
});

const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];

it.runIf(process.env['CI'] && !superUrl)('has its superuser test database in CI', () => {
  expect.fail('TEST_DATABASE_SUPERUSER_URL is not set: in CI the trigram tests must run, not skip');
});

describe.skipIf(!superUrl)('the trigram index, searched as the app login (RC-160)', () => {
  const client = new pg.Client({ connectionString: superUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('begin');
    // Made as the owner would make it, from the helper's own DDL; then read as the app, all in one rolled-back transaction.
    await client.query('set local role radcore_owner');
    for (const statement of await ddl()) await client.query(statement);
    await client.query('grant usage on schema trgm_fixture to radcore_app');
    await client.query('grant select on trgm_fixture.parties to radcore_app');
    await client.query(`insert into trgm_fixture.parties (id, name)
      select gen_random_uuid(), 'Party ' || n from generate_series(1, 500) n`);
    await client.query("insert into trgm_fixture.parties (id, name) values (gen_random_uuid(), 'Asha Motors')");
    await client.query('analyze trgm_fixture.parties');
    await client.query('set local role radcore_app');
  });

  afterAll(async () => {
    await client.query('rollback');
    await client.end();
  });

  it('finds a partial name through the index, not by reading every row', async () => {
    await client.query('savepoint plan');
    try {
      await client.query('set local enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        "explain select id from trgm_fixture.parties where name ilike '%sha mot%'");
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('Bitmap Index Scan on ix_parties_name_trgm');
      expect(plan).not.toMatch(/Seq Scan/);
      const found = await client.query<{ name: string }>("select name from trgm_fixture.parties where name ilike '%sha mot%'");
      expect(found.rows).toEqual([{ name: 'Asha Motors' }]);
    } finally {
      await client.query('rollback to savepoint plan');
    }
  });

  it("can't call pg_trgm's functions by name", async () => {
    await client.query('savepoint call');
    try {
      await expect(client.query("select radcore_ext.similarity('a', 'b')")).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('rollback to savepoint call');
    }
  });
});
