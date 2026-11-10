// RAD-26 (M1-08, ADR-002 §4, ADR-001 §5 T1): the opaque transaction and the module transaction on a real PostgreSQL.
// A module transaction writes only its own tables, never without a bounded filter, inside savepoints too, and its
// relational callbacks get no `sql`. The opener sets the request context and the contract's statement timeout for
// that transaction only. The tables live in a schema of this file's own, dropped afterwards.
import { randomBytes } from 'node:crypto';
import { notInNonEmpty } from '../packages/db/src/conditions.ts';
import { ForeignTableError, moduleTx, UnboundedWriteError } from '../packages/db/src/module-tx.ts';
import { openTransaction, type Database } from '../packages/db/src/schema.ts';
import { createDatabase } from '../packages/lib-platform/src/db/client.ts';
import { runInTransaction } from '../packages/lib-platform/src/db/transaction.ts';
import { defineSetting } from '../packages/lib-platform/src/settings.ts';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { integer, pgSchema, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The owner login: this file makes a schema and tables of its own (RAD-24).
const url = process.env['TEST_DATABASE_OWNER_URL'];
const fixture = pgSchema(`mtx_${randomBytes(6).toString('hex')}`);
const own = fixture.table('own_items', { id: uuid().primaryKey().defaultRandom(), n: integer().notNull() });
const other = fixture.table('other_items', { id: uuid().primaryKey().defaultRandom(), n: integer().notNull() });
const ownTx = moduleTx({ own });
const who = { principal: 'user:test', requestId: 'req-1' };
const write = { readOnly: false, isolation: 'read committed' } as const;
const read = { readOnly: true, isolation: 'read committed' } as const;

// The SQLSTATE or error class a promise fails with.
const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? (e as Error).name);

describe.skipIf(!url)('the module transaction', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db: Database = createDatabase(pool, { own, other });

  beforeAll(async () => {
    await pool.query(`create schema ${fixture.schemaName}`);
    for (const t of ['own_items', 'other_items']) {
      await pool.query(`create table ${fixture.schemaName}.${t} (id uuid primary key default gen_random_uuid(), n int not null)`);
    }
    await pool.query(`insert into ${fixture.schemaName}.own_items (n) values (1), (2)`);
  });

  afterAll(async () => {
    await pool.query(`drop schema ${fixture.schemaName} cascade`);
    await pool.end();
  });

  // Each test's writes roll back, so the shuffled order doesn't matter.
  const inRollback = (fn: (ctx: { tx: Parameters<typeof ownTx>[0]['tx'] }) => Promise<void>) =>
    failure(openTransaction(db, write, who, async (tx) => {
      await fn({ tx });
      throw new Error('rolled back');
    })).then((r) => expect(r).toBe('Error'));

  it('writes its own tables, and refuses a foreign one by table, at run time', async () => {
    await inRollback(async (ctx) => {
      const t = ownTx(ctx);
      expect(await t.insert(own).values({ n: 3 }).returning({ n: own.n })).toEqual([{ n: 3 }]);
      // The types refuse these too; the casts stand for a table obtained some other way.
      const foreign = other as unknown as typeof own;
      expect(() => t.insert(foreign)).toThrow(ForeignTableError);
      expect(() => t.update(foreign)).toThrow(ForeignTableError);
      expect(() => t.delete(foreign)).toThrow(ForeignTableError);
    });
  });

  it('refuses an update or delete with an empty filter, or with none', async () => {
    await inRollback(async (ctx) => {
      const t = ownTx(ctx);
      expect(() => t.update(own).set({ n: 0 }).where(undefined)).toThrow(UnboundedWriteError);
      expect(() => t.delete(own).where(and(undefined, undefined))).toThrow(UnboundedWriteError);
      expect(await failure(t.update(own).set({ n: 0 }).then(() => undefined))).toBe('UnboundedWriteError');
      expect(await failure(t.delete(own).execute())).toBe('UnboundedWriteError');
      expect(await t.update(own).set({ n: 9 }).where(eq(own.n, 1)).returning({ n: own.n })).toEqual([{ n: 9 }]);
      expect((await t.select({ n: own.n }).from(own)).map((r) => r.n).sort()).toEqual([2, 9]);
    });
  });

  // catch and finally run the query through then; prepare and _prepare are what execute uses.
  it('refuses every way to run an update or delete before its filter, and hides each builder session', async () => {
    await inRollback(async (ctx) => {
      const t = ownTx(ctx);
      expect(await t.update(own).set({ n: 0 }).catch((e: unknown) => (e as Error).name)).toBe('UnboundedWriteError');
      expect(await failure(t.delete(own).finally(() => undefined))).toBe('UnboundedWriteError');
      expect(() => t.delete(own).prepare('p')).toThrow(UnboundedWriteError);
      const builders = [t.insert(own), t.insert(own).values({ n: 1 }), t.select().from(own), t.update(own),
        t.update(own).set({ n: 1 }), t.delete(own), t.query.own.findMany()] as unknown as Record<string, unknown>[];
      expect(builders.map((b) => [b['session'], b['_'], b['_prepare'], b['config'], b['dialect']]))
        .toEqual(builders.map(() => [undefined, undefined, undefined, undefined, undefined]));
      // A where a guard checked can't be cleared afterwards through a cast.
      const filtered = t.update(own).set({ n: 0 }).where(eq(own.n, 1)) as unknown as Record<string, unknown>;
      expect(() => { filtered['config'] = {}; }).toThrow(TypeError);
      expect(() => Object.defineProperty(filtered, 'config', { value: {} })).toThrow(TypeError);
      expect(() => delete filtered['where']).toThrow(TypeError);
      expect((await t.select({ n: own.n }).from(own)).map((r) => r.n).sort()).toEqual([1, 2]);
    });
  });

  // A forEach(async ...) is enough to run a builder after its transaction has gone back to the pool.
  it('refuses a module object, builder or savepoint kept past its transaction', async () => {
    const kept: { t?: ReturnType<typeof ownTx>; pending?: PromiseLike<unknown>; savepoint?: ReturnType<typeof ownTx> } = {};
    await openTransaction(db, write, who, async (tx) => {
      kept.t = ownTx({ tx });
      kept.pending = kept.t.insert(own).values({ n: 77 });
      await kept.t.transaction(async (s) => {
        kept.savepoint = s;
      });
      expect(() => kept.savepoint?.insert(own)).toThrow(/ended/);
    });
    expect(() => kept.t?.insert(own)).toThrow(/ended/);
    expect(await failure(Promise.resolve(kept.pending))).toBe('Error');
    expect(Number((await pool.query(`select count(*) from ${fixture.schemaName}.own_items where n = 77`)).rows[0]?.count)).toBe(0);
  });

  it('refuses query.<key> when the client holds another table under that key', async () => {
    const mixed = createDatabase(pool, { own: other });
    expect(await failure(openTransaction(mixed, read, who, (tx) => ownTx({ tx }).query.own.findMany().then(() => undefined))))
      .toBe('ForeignTableError');
  });

  it('keeps the same guards inside a savepoint, which gets a module transaction, not the raw one', async () => {
    await inRollback(async (ctx) => {
      await ownTx(ctx).transaction(async (t) => {
        expect(Object.keys(t).sort()).toEqual(['delete', 'insert', 'query', 'select', 'transaction', 'update']);
        expect(() => t.insert(other as unknown as typeof own)).toThrow(ForeignTableError);
        expect(() => t.delete(own).where(undefined)).toThrow(UnboundedWriteError);
      });
    });
  });

  it('gives relational callbacks operators without sql or notInArray, and refuses extras', async () => {
    await inRollback(async (ctx) => {
      const seen: string[][] = [];
      const rows = await ownTx(ctx).query.own.findMany({
        where: (f, ops) => {
          seen.push(Object.keys(ops));
          return ops.eq(f.n, 2);
        },
        orderBy: (f, ops) => {
          seen.push(Object.keys(ops));
          return [ops.asc(f.n)];
        },
        columns: { n: true },
      });
      expect(rows).toEqual([{ n: 2 }]);
      expect(seen.flat().filter((k) => k === 'sql' || k === 'notInArray')).toEqual([]);
      expect(seen[0]).toContain('eq');
      expect(() => ownTx(ctx).query.own.findMany({ extras: { x: sql<number>`1`.as('x') } })).toThrow(/extras/);
    });
  });

  it('has an opaque ctx.tx with no members, dead once its transaction ends', async () => {
    let leaked: { tx: Parameters<typeof ownTx>[0]['tx'] } | undefined;
    await openTransaction(db, read, who, async (tx) => {
      leaked = { tx };
      expect([Object.keys(tx), Object.getOwnPropertySymbols(tx), Object.getPrototypeOf(tx)]).toEqual([[], [], null]);
    });
    expect(() => ownTx(leaked ?? { tx: Object.freeze(Object.create(null)) })).toThrow(/ended/);
  });

  it('sets the principal, request id and statement timeout for that transaction only', async () => {
    const settings = (tx: Parameters<typeof ownTx>[0]['tx']) => ownTx({ tx }).select({
      principal: sql<string>`current_setting('app.principal')`, requestId: sql<string>`current_setting('app.request_id')`,
      timeout: sql<string>`current_setting('statement_timeout')`, readOnly: sql<string>`current_setting('transaction_read_only')`,
      isolation: sql<string>`current_setting('transaction_isolation')` }).from(own).limit(1);
    const before = await openTransaction(db, read, who, settings);
    expect(await openTransaction(db, { readOnly: true, isolation: 'repeatable read', statementTimeoutMs: 1500 },
      { principal: 'system:report', requestId: 'req-2' }, settings))
      .toEqual([{ principal: 'system:report', requestId: 'req-2', timeout: '1500ms', readOnly: 'on', isolation: 'repeatable read' }]);
    expect(await openTransaction(db, read, who, settings)).toEqual(before);
    expect(before[0]).toMatchObject({ principal: 'user:test', requestId: 'req-1', readOnly: 'on', isolation: 'read committed' });
  });

  it('runs a service with a frozen Ctx of three members, as the named principal', async () => {
    const principal = { kind: 'user', userId: 'u-1', permissions: ['sales:read'] } as const;
    const rows = await runInTransaction(db, read, principal, 'req-9', async (ctx) => {
      expect([Object.isFrozen(ctx), Object.keys(ctx).sort()]).toEqual([true, ['principal', 'requestId', 'settings', 'tx']]);
      return ownTx(ctx).select({ p: sql<string>`current_setting('app.principal')`, r: sql<string>`current_setting('app.request_id')` })
        .from(own).limit(1);
    });
    expect(rows).toEqual([{ p: 'user:u-1', r: 'req-9' }]);
    expect(await runInTransaction(db, read, { kind: 'system', name: 'nightly', permissions: [] }, 'req-10', (ctx) =>
      ownTx(ctx).select({ p: sql<string>`current_setting('app.principal')` }).from(own).limit(1))).toEqual([{ p: 'system:nightly' }]);
  });

  // RAD-48's mechanism: one read of the settings table when the Ctx is built, typed values from memory after.
  it("gives the service the settings read once at the start of its transaction, and each one's default when unset", async () => {
    const stored = defineSetting(`platform.test_${randomBytes(4).toString('hex')}`, z.number().int(), 1);
    const unset = defineSetting(`platform.test_${randomBytes(4).toString('hex')}`, z.string(), 'fallback');
    // Settings rows carry audit columns, so the insert says who made it.
    const asTest = async (text: string, values: unknown[]) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        await c.query(text, values);
        await c.query('commit');
      } finally {
        c.release();
      }
    };
    await asTest('insert into radcore.settings (key, value) values ($1, $2)', [stored.key, JSON.stringify(7)]);
    try {
      expect(await runInTransaction(db, read, { kind: 'system', name: 'test', permissions: [] }, 'req-11',
        async (ctx) => [ctx.settings.get(stored), ctx.settings.get(unset)])).toEqual([7, 'fallback']);
    } finally {
      await asTest('delete from radcore.settings where key = $1', [stored.key]);
    }
  });

  it('cancels a statement past the contract timeout, and refuses a write in a read-only transaction', async () => {
    expect(await failure(openTransaction(db, { ...read, statementTimeoutMs: 50 }, who, (tx) =>
      ownTx({ tx }).select({ x: sql`pg_sleep(1)` }).from(own).limit(1)))).toBe('57014');
    expect(await failure(openTransaction(db, read, who, (tx) => ownTx({ tx }).insert(own).values({ n: 5 }).then(() => undefined))))
      .toBe('25006');
  });

  it('refuses a timeout that would switch the limit off, and a write that is not read committed', async () => {
    expect(await failure(openTransaction(db, { ...read, statementTimeoutMs: 0 }, who, async () => undefined))).toBe('TypeError');
    expect(await failure(openTransaction(db, { readOnly: false, isolation: 'repeatable read' } as unknown as typeof write, who,
      async () => undefined))).toBe('TypeError');
  });
});

it('notInNonEmpty refuses an empty list, which would make a whole-table write', () => {
  expect(() => notInNonEmpty(own.n, [])).toThrow(/empty/);
  expect(notInNonEmpty(own.n, [1])).toBeDefined();
});
