// RAD-25 (M1-07, RC-052): the migration runner on a real PostgreSQL. It applies the migrations once, under an advisory
// lock, in one transaction, forward-only, from an empty database and as an upgrade. Each test makes its own empty
// database and drops it, so the shuffled order doesn't matter.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { getConstructionPlans } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { MIGRATIONS_FOLDER, migrate } from '../packages/db/src/migrate.ts';

const url = process.env['TEST_DATABASE_URL'];
// The commit CI compares the migrations with (.github/workflows/ci.yml).
const base = process.env['MIGRATIONS_BASE'];

type Journal = { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
const readJournal = (dir: string) => JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as Journal;
const MIGRATIONS = readJournal(MIGRATIONS_FOLDER).entries.length;

// pg-boss's construction plan without the transaction it wraps itself in; the migrator already runs one.
const pgbossBody = () => {
  const m = /^\s*BEGIN;\s*SET LOCAL lock_timeout = \d+;\s*SET LOCAL idle_in_transaction_session_timeout = \d+;\s*([\s\S]*?);\s*COMMIT;\s*$/
    .exec(getConstructionPlans('pgboss'));
  if (!m?.[1]) throw new Error("pg-boss's construction plan changed shape");
  return `${m[1]};\n`;
};

async function query<T extends pg.QueryResultRow>(dbUrl: string, text: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    return (await c.query<T>(text)).rows;
  } finally {
    await c.end();
  }
}
const applied = async (dbUrl: string) => (await query<{ n: number }>(dbUrl,
  "select case when to_regclass('drizzle.__drizzle_migrations') is null then 0 else (select count(*)::int from drizzle.__drizzle_migrations) end as n"))[0]?.n;
const hasSchema = async (dbUrl: string, name: string) =>
  (await query<{ ok: boolean }>(dbUrl, `select to_regnamespace('${name}') is not null as ok`))[0]?.ok;

// A fresh empty database for one test, dropped afterwards.
async function withDatabase(fn: (dbUrl: string) => Promise<void>) {
  const name = `radcore_mig_${randomBytes(8).toString('hex')}`;
  await query(url ?? '', `create database ${name}`);
  const dbUrl = new URL(url ?? '');
  dbUrl.pathname = `/${name}`;
  try {
    await fn(dbUrl.toString());
  } finally {
    await query(url ?? '', `drop database if exists ${name} with (force)`);
  }
}

// A copy of the migrations folder as an earlier release had it (`keep` entries), plus `extra` migrations after them.
async function withFolder(keep: number, extra: string[], fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'radcore-migrations-'));
  try {
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journal = readJournal(dir);
    journal.entries = journal.entries.slice(0, keep);
    const last = journal.entries.at(-1)?.when ?? 0;
    extra.forEach((text, i) => {
      const tag = `${String(keep + i).padStart(4, '0')}_extra`;
      writeFileSync(join(dir, `${tag}.sql`), text);
      journal.entries.push({ idx: keep + i, version: '7', when: last + i + 1, tag, breakpoints: true });
    });
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the migration tests must run, not skip');
});

describe('the migration files', () => {
  // drizzle applies a migration only if its `when` is later than the last one applied, so one merged from a parallel
  // branch with an earlier `when` would be skipped on every database already migrated, while CI's fresh one applies it.
  it('are in journal order, each `when` later than the one before (regenerate yours after merging dev)', () => {
    const entries = readJournal(MIGRATIONS_FOLDER).entries;
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    expect(entries.filter((e, i) => i > 0 && e.when <= (entries[i - 1]?.when ?? 0)).map((e) => e.tag)).toEqual([]);
  });

  // Against the base commit (a PR's base, or the commit before a push): a branch whose migration is older than one
  // that merged meanwhile fails here before the journal merge would hide it, and merged migrations never change.
  it.runIf(process.env['CI'] && !base)('has the base commit in CI', () => {
    expect.fail('MIGRATIONS_BASE is not set: in CI the migrations are compared with the base commit');
  });

  it.skipIf(!base)('dates each new migration after the newest one at the base, and leaves merged ones unchanged', () => {
    const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' });
    expect(git('rev-parse', '--verify', `${base}^{commit}`).status).toBe(0);
    const shown = git('show', `${base}:packages/db/migrations/meta/_journal.json`);
    // Before the first migration merged, the base has no journal.
    const merged = shown.status === 0 ? (JSON.parse(shown.stdout) as Journal).entries : [];
    const entries = readJournal(MIGRATIONS_FOLDER).entries;
    const newest = Math.max(0, ...merged.map((e) => e.when));
    expect(entries.filter((e) => !merged.some((m) => m.tag === e.tag) && e.when <= newest).map((e) => e.tag)).toEqual([]);
    expect(merged.filter((m) => !entries.some((e) => e.tag === m.tag && e.when === m.when)).map((m) => m.tag)).toEqual([]);
    const lf = (s: string) => s.replaceAll('\r\n', '\n');
    expect(merged.filter((m) => lf(git('show', `${base}:packages/db/migrations/${m.tag}.sql`).stdout)
      !== lf(readFileSync(join(MIGRATIONS_FOLDER, `${m.tag}.sql`), 'utf8'))).map((m) => m.tag)).toEqual([]);
  });

  // ADR-002: L3 is off in migrate.ts for the advisory lock only.
  it('migrate.ts makes exactly one raw call, the lock', () => {
    const source = readFileSync(join(MIGRATIONS_FOLDER, '..', 'src', 'migrate.ts'), 'utf8');
    expect(source.match(/\.(query|execute|unsafe)\(/g)).toEqual(['.query(']);
  });

  it("creates pg-boss's schema from pg-boss's own construction plan (ADR-002 §4)", () => {
    // A Windows checkout may have CRLF line ends.
    const file = readFileSync(join(MIGRATIONS_FOLDER, '0001_pgboss.sql'), 'utf8').replaceAll('\r\n', '\n');
    // shortcut: pins 0001 to pg-boss 12.38.0's plan; upgrading pg-boss adds a migration from getMigrationPlans instead.
    expect(file.split('\n').filter((l) => !l.startsWith('-- ')).join('\n')).toBe(pgbossBody());
  });
});

describe.skipIf(!url)('the migration runner', () => {
  it('migrates an empty database, and a second run finds nothing to do', async () => {
    await withDatabase(async (db) => {
      await migrate(db);
      expect(await applied(db)).toBe(MIGRATIONS);
      expect(await hasSchema(db, 'radcore')).toBe(true);
      const version = /INSERT INTO pgboss\.version\(version\) VALUES \('(\d+)'\)/.exec(pgbossBody())?.[1];
      expect((await query<{ version: number }>(db, 'select version from pgboss.version'))).toEqual([{ version: Number(version) }]);
      await migrate(db);
      expect(await applied(db)).toBe(MIGRATIONS);
    });
  });

  it('upgrades a database an earlier release migrated', async () => {
    await withDatabase(async (db) => {
      await withFolder(1, [], (dir) => migrate(db, dir));
      expect(await applied(db)).toBe(1);
      expect(await hasSchema(db, 'pgboss')).toBe(false);
      await migrate(db);
      expect(await applied(db)).toBe(MIGRATIONS);
      expect(await hasSchema(db, 'pgboss')).toBe(true);
    });
  });

  it('is forward-only: an earlier release on a newer database changes nothing', async () => {
    await withDatabase(async (db) => {
      await migrate(db);
      await withFolder(1, [], (dir) => migrate(db, dir));
      expect(await applied(db)).toBe(MIGRATIONS);
    });
  });

  it('applies nothing when one pending migration fails', async () => {
    await withDatabase(async (db) => {
      await withFolder(MIGRATIONS, ['create table public.probe (x int);', 'select from no_such_table;'], async (dir) => {
        await expect(migrate(db, dir)).rejects.toThrow(/no_such_table/);
      });
      expect(await applied(db)).toBe(0);
      expect(await hasSchema(db, 'radcore')).toBe(false);
      expect(await query(db, "select to_regclass('public.probe') as t")).toEqual([{ t: null }]);
    });
  });

  it('waits for the advisory lock, so two runners never apply the same migration', async () => {
    await withDatabase(async (db) => {
      const holder = new pg.Client({ connectionString: db });
      await holder.connect();
      try {
        await holder.query("select pg_advisory_lock(hashtextextended('radcore.migrate', 0))");
        const run = migrate(db);
        await vi.waitFor(async () => expect(await query(db,
          "select 1 from pg_stat_activity where application_name = 'radcore-migrate' and wait_event_type = 'Lock'")).toHaveLength(1));
        expect(await hasSchema(db, 'radcore')).toBe(false);
        await holder.query("select pg_advisory_unlock(hashtextextended('radcore.migrate', 0))");
        await run;
      } finally {
        await holder.end();
      }
      expect(await applied(db)).toBe(MIGRATIONS);
    });
  });

  it('runs once when two runners start together', async () => {
    await withDatabase(async (db) => {
      await Promise.all([migrate(db), migrate(db)]);
      expect(await applied(db)).toBe(MIGRATIONS);
    });
  });

  it('writes as system:migrate, under a 5s lock timeout (ADR-004 §3, ADR-005 §5)', async () => {
    await withDatabase(async (db) => {
      await withFolder(MIGRATIONS, ["create table public.probe as select current_setting('app.principal') as principal,"
        + " current_setting('lock_timeout') as lock_timeout, current_setting('statement_timeout') as statement_timeout;"],
      (dir) => migrate(db, dir));
      expect(await query(db, 'select * from public.probe'))
        .toEqual([{ principal: 'system:migrate', lock_timeout: '5s', statement_timeout: '15min' }]);
    });
  });
});
