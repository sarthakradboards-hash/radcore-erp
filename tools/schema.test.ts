// ADR-005's schema rules (M1-05), read from a real PostgreSQL 16 database through the views in packages/db/views:
// every numeric column has its CHECK, every foreign key an index (RC-029), every table its four audit columns, no
// enums (RC-044), no name over 63 bytes, and nothing in `public` (§7c). Fixture tables prove each rule fires, and the helpers' CHECKs refuse
// what they should (RC-024, NaN included).
//
// The real schema is the run's database, migrated from zero by `npm run db:migrate` (tools/test-database.ts, RAD-25).
// The fixtures come from drizzle-kit's own generator as a diff on top of it, applied inside one transaction that is
// rolled back, so this file leaves the database as it found it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import type { DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { getTableConfig, index, numeric, pgSchema, text, uuid, type PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@radcore/db/schema';
import * as views from '@radcore/db/views';
import {
  boundedText, foreignMoney, fxRate, id, lookupTable, money, percent, qty, radcore, radcoreTable, unitPrice,
} from '../packages/db/src/columns.ts';
import { MIGRATIONS_FOLDER } from '../packages/db/src/migrate.ts';

// Tables built with the helpers: they must pass every rule.
const fixtureUnits = lookupTable('fixture_units');
const fixtureLines = radcoreTable('fixture_lines', {
  id: id(),
  unitCode: text().notNull().references(() => fixtureUnits.code),
  amount: money().notNull(),
  balance: money({ signed: true }),
  foreignAmount: foreignMoney(),
  linePrice: unitPrice(),
  lineQty: qty({ line: true }),
  stockQty: qty(),
  tax: percent(),
  cess: percent({ max: 290 }),
  fx: fxRate(),
  note: boundedText(),
  shortNote: boundedText({ max: 5 }),
}, (t) => [index('ix_fixture_lines_unit_code').on(t.unitCode)]);

// Tables that break each rule, in their own schema.
const bad = pgSchema('guard_bad');
const badParents = bad.table('parents', { id: uuid().primaryKey() });
const badRawNumbers = bad.table('raw_numbers', { id: uuid().primaryKey(), amount: numeric({ precision: 18, scale: 2 }) });
const badChildren = bad.table('children', { id: uuid().primaryKey(), parentId: uuid().references(() => badParents.id) });
const badColour = bad.enum('colour', ['red', 'green']);
const badLongName = bad.table('long_names', { id: uuid().primaryKey(), x: text() },
  (t) => [index(`ix_${'very_long_name_'.repeat(5)}`).on(t.x)]);

const tables = (mod: Record<string, unknown>) => Object.values(mod).filter((v): v is PgTable =>
  typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v);

/** Constraint and index names over 63 bytes, which PostgreSQL would silently truncate (ADR-005 §1). */
function longNames(ts: PgTable[]): string[] {
  return ts.flatMap((t) => {
    const c = getTableConfig(t);
    const names = [
      ...c.checks.map((k) => k.name), ...c.indexes.map((i) => i.config.name ?? ''),
      ...c.foreignKeys.map((f) => f.getName()), ...c.uniqueConstraints.map((u) => u.getName()),
      ...c.primaryKeys.map((p) => p.getName()),
    ];
    return names.filter((n): n is string => typeof n === 'string' && Buffer.byteLength(n) > 63).map((n) => `${c.name}: ${n}`);
  });
}

// What drizzle.config.ts generates migrations from.
const real = { ...schema, ...views, radcore };
const snapshotOf = (objects: Record<string, unknown>) => generateDrizzleJson(objects, undefined, undefined, 'snake_case');
const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number }[] };

describe('migrations', () => {
  it('are up to date with the schema: `npx drizzle-kit generate` would write nothing', async () => {
    const last = String(journal.entries.at(-1)?.idx ?? 0).padStart(4, '0');
    const committed = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', `${last}_snapshot.json`), 'utf8')) as DrizzleSnapshotJSON;
    expect(await generateMigration(committed, snapshotOf(real))).toEqual([]);
  });
});

describe('names', () => {
  it('has no constraint or index name over 63 bytes in the schema or the helper fixtures', () => {
    expect(longNames([...tables(schema), fixtureUnits, fixtureLines])).toEqual([]);
  });

  it('catches a name over 63 bytes', () => {
    expect(longNames([badLongName])).toHaveLength(1);
  });
});

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the schema tests must run, not skip');
});

describe.skipIf(!url)('schema rules on PostgreSQL', () => {
  const client = new pg.Client({ connectionString: url });

  beforeAll(async () => {
    await client.connect();
    await client.query('begin');
    const fixtures = { fixtureUnits, fixtureLines, bad, badParents, badRawNumbers, badChildren, badColour };
    const ddl = await generateMigration(snapshotOf(real), snapshotOf({ ...real, ...fixtures }));
    for (const statement of ddl) await client.query(statement);
    // As the runtime logins will (ADR-005 §7c): unqualified names resolve in `radcore` only, never in `public`.
    await client.query('set local search_path = radcore');
    await client.query("set local app.principal = 'system:test'");
    // Rows every test may rely on; each test's own writes run in a savepoint, so the shuffled order doesn't matter.
    await client.query("insert into fixture_units (code, label) values ('nos', 'Numbers'), ('store', 'Store')");
  });

  afterAll(async () => {
    await client.query('rollback');
    await client.end();
  });

  it('reads the database the migrations built from zero', async () => {
    const { rows: [row] } = await client.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(row?.n).toBe(journal.entries.length);
  });

  const rows = async (view: string) => (await client.query<Record<string, string>>(`select * from ${view}`)).rows;
  const outside = (schemaName: string) => (r: Record<string, string>) => r['schema_name'] !== schemaName;

  it('finds no rule broken outside the fixture schema (the real schema and the helper fixtures)', async () => {
    for (const view of ['v_schema_numeric_without_check', 'v_schema_fk_without_index', 'v_schema_missing_audit', 'v_schema_enums',
      'v_schema_public_relations']) {
      expect((await rows(view)).filter(outside('guard_bad')), view).toEqual([]);
    }
  });

  it('reports each broken rule in the fixture schema', async () => {
    const inBad = async (view: string) => (await rows(view)).filter((r) => r['schema_name'] === 'guard_bad');
    expect(await inBad('v_schema_numeric_without_check')).toEqual([
      { schema_name: 'guard_bad', table_name: 'raw_numbers', column_name: 'amount' }]);
    expect((await inBad('v_schema_fk_without_index')).map((r) => r['table_name'])).toEqual(['children']);
    expect((await inBad('v_schema_missing_audit')).map((r) => r['table_name']).sort()).toEqual(['children', 'parents', 'raw_numbers']);
    expect(await inBad('v_schema_enums')).toEqual([{ schema_name: 'guard_bad', type_name: 'colour' }]);
  });

  it('reports a table or view in public (ADR-005 §7c)', async () => {
    await client.query('savepoint stray');
    try {
      await client.query('create table public.stray (id int)');
      await client.query('create view public.stray_view as select 1 as one');
      expect((await rows('v_schema_public_relations')).map((r) => r['table_name']).sort()).toEqual(['stray', 'stray_view']);
    } finally {
      await client.query('rollback to savepoint stray');
    }
  });

  // Runs `sql` in a savepoint and returns the SQLSTATE it raised, or 'ok'.
  const attempt = async (sql: string, params: unknown[] = []) => {
    await client.query('savepoint attempt');
    try {
      await client.query(sql, params);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'error';
    } finally {
      await client.query('rollback to savepoint attempt');
    }
  };
  const line = (column: string, value: unknown) => attempt(
    `insert into fixture_lines (unit_code, amount, ${column}) values ('nos', 10, $1)`, [value]);

  it('keeps lookup codes and labels distinct (RC-044)', async () => {
    expect(await attempt("insert into fixture_units (code, label) values ('kg', 'Kilograms')")).toBe('ok');
    expect(await attempt("insert into fixture_units (code, label) values ('stores', 'Stores')")).toBe('23505');
    expect(await attempt("insert into fixture_units (code, label) values ('st_ore', 'Other')")).toBe('23505');
    expect(await attempt("insert into fixture_units (code, label) values ('kg', 'STORE')")).toBe('23505');
    expect(await attempt("insert into fixture_units (code, label) values ('kg', ' Store ')")).toBe('23505');
    expect(await attempt("insert into fixture_units (code, label) values ('room', 'Store Room'), ('hall', 'store \t room')"))
      .toBe('23505');
    expect(await attempt("insert into fixture_units (code, label) values ('Bad Code', 'Bad')")).toBe('23514');
  });

  it("holds each helper's CHECK, NaN included (RC-024)", async () => {
    expect(await line('balance', -5)).toBe('ok');
    expect(await attempt("insert into fixture_lines (unit_code, amount) values ('nos', -1)")).toBe('23514');
    expect(await attempt("insert into fixture_lines (unit_code, amount) values ('nos', 'NaN')")).toBe('23514');
    expect(await line('balance', 'NaN')).toBe('23514');
    expect(await line('line_price', 'NaN')).toBe('23514');
    expect(await line('foreign_amount', -0.0001)).toBe('23514');
    expect(await line('line_qty', 0)).toBe('23514');
    expect(await line('line_qty', 'NaN')).toBe('23514');
    expect(await line('stock_qty', 0)).toBe('ok');
    expect(await line('tax', 101)).toBe('23514');
    expect(await line('tax', 'NaN')).toBe('23514');
    expect(await line('cess', 150)).toBe('ok');
    expect(await line('cess', 291)).toBe('23514');
    expect(await line('fx', 0)).toBe('23514');
    expect(await line('short_note', 'abcdef')).toBe('23514');
    expect(await line('note', 'x'.repeat(201))).toBe('23514');
  });

  it('stores a unit price of 0.375 exactly (RC-008)', async () => {
    await client.query('savepoint price');
    try {
      const { rows: [row] } = await client.query<{ line_price: string }>(
        "insert into fixture_lines (unit_code, amount, line_price) values ('nos', 1, 0.375) returning line_price");
      expect(row?.line_price).toBe('0.375000');
    } finally {
      await client.query('rollback to savepoint price');
    }
  });

  it('refuses a write with no principal in the request context', async () => {
    await client.query('savepoint principal');
    try {
      await client.query("set local app.principal = ''");
      expect(await attempt("insert into fixture_lines (unit_code, amount) values ('nos', 1)")).toBe('23502');
    } finally {
      await client.query('rollback to savepoint principal');
    }
  });
});
