// The module transaction (ADR-002 §4, ADR-001 §5 T1): a runtime object, not a type alias. Each module's entry
// (`@radcore/db/<module>`) builds one from its own tables, `salesTx = moduleTx({ ...tables, ...relations })`, and only
// that module's library may import it (D7). It wraps the request's transaction and exposes only:
// - `query.<own table>`: relational reads, whose where and orderBy callbacks get operators without `sql` or
//   `notInArray`, and which refuse `extras` (raw SQL);
// - `select()`: the query builder, not checked at run time (D7 limits what it can read: only the owner imports a table);
// - `insert`, `update`, `delete`: own tables only, by type and at run time; an update or delete must have a filter;
// - `transaction(cb)`: a savepoint, whose `cb` gets a module transaction again.
// It has no `execute`, `_`, `$with` or driver handle, and the builders it hands out have no `session` or `_` members:
// those don't exist on the objects, so no cast reaches the pool's client. Everything refuses to run once its
// transaction has ended.
import { getOperators, getOrderByOperators, getTableName, type ExtractTablesWithRelations, type SQL } from 'drizzle-orm';
import type { PgDeleteBase, PgInsertBuilder, PgQueryResultHKT, PgTable, PgUpdateBuilder } from 'drizzle-orm/pg-core';
import type { RelationalQueryBuilder } from 'drizzle-orm/pg-core/query-builders/query';
import { bind, rawOf, unbind, type RawTx, type Tx } from './tx.ts';

export class UnboundedWriteError extends Error {
  override name = 'UnboundedWriteError';
}
export class ForeignTableError extends Error {
  override name = 'ForeignTableError';
}

type TableKeys<S> = { [K in keyof S]: S[K] extends PgTable ? K : never }[keyof S];
type OwnTable<S> = Extract<S[TableKeys<S>], PgTable>;
type Config<S extends Record<string, unknown>> = ExtractTablesWithRelations<S>;
type HKT = PgQueryResultHKT;

export type ModuleTx<S extends Record<string, unknown>> = {
  // shortcut: the callbacks' operator types still list `sql` and `notInArray`; they're removed at run time, and L1
  // refuses `sql` in any library. Narrow the types too if a module ever needs a callback L1 can't see into.
  readonly query: { readonly [K in TableKeys<S> & keyof Config<S>]: RelationalQueryBuilder<Config<S>, Config<S>[K]> };
  readonly select: RawTx['select'];
  readonly insert: <T extends OwnTable<S>>(table: T) => PgInsertBuilder<T, HKT>;
  readonly update: <T extends OwnTable<S>>(table: T) => PgUpdateBuilder<T, HKT>;
  readonly delete: <T extends OwnTable<S>>(table: T) => PgDeleteBase<T, HKT>;
  readonly transaction: <R>(cb: (tx: ModuleTx<S>) => Promise<R>) => Promise<R>;
};

// Drizzle's operator objects without raw SQL, and without the exclusion that matches every row on an empty list.
const without = (ops: object, names: readonly string[]) =>
  Object.freeze(Object.fromEntries(Object.entries(ops).filter(([k]) => !names.includes(k))));
const SAFE_WHERE = without(getOperators(), ['sql', 'notInArray']);
const SAFE_ORDER = without(getOrderByOperators(), ['sql']);

type Callback = (fields: unknown, ops: unknown) => unknown;
type QueryConfig = { where?: unknown; orderBy?: unknown; extras?: unknown; with?: Record<string, unknown> };

// The same config with each callback given the safe operators, nested `with` configs included.
function safeConfig(config: QueryConfig | undefined): QueryConfig | undefined {
  if (config === undefined) return config;
  if (config.extras !== undefined) throw new TypeError('A module transaction refuses relational `extras`, which are raw SQL');
  const out: QueryConfig = { ...config };
  const { where, orderBy } = config;
  if (typeof where === 'function') out.where = (fields: unknown) => (where as Callback)(fields, SAFE_WHERE);
  if (typeof orderBy === 'function') out.orderBy = (fields: unknown) => (orderBy as Callback)(fields, SAFE_ORDER);
  if (config.with !== undefined) {
    out.with = Object.fromEntries(Object.entries(config.with).map(([k, v]) =>
      [k, typeof v === 'object' && v !== null ? safeConfig(v) : v]));
  }
  return out;
}

const unbounded = (what: string) => new UnboundedWriteError(`${what} needs a filter: an empty or missing where would write every row`);

// Every member that runs the query. catch and finally call then, and _prepare is what execute uses.
const RUNS = new Set<PropertyKey>(['then', 'catch', 'finally', 'execute', 'prepare', '_prepare']);
// A builder holds its session (and with it the pool's client), its config (the where a guard checked) and its dialect;
// nothing outside Drizzle may reach them.
const hidden = (prop: PropertyKey) => prop === 'session' || prop === 'config' || prop === 'dialect'
  || (typeof prop === 'string' && prop.startsWith('_'));
const sealed = (): never => {
  throw new TypeError("A module transaction's builders can't be changed from outside");
};
const isBuilder = (v: unknown): v is object => typeof v === 'object' && v !== null && 'session' in v;

/**
 * A Drizzle builder as a module transaction hands it out: no session or `_` members; a query that runs only while
 * its transaction is alive (`alive` throws once it ended); and, for an update or delete (`write` names it), no run at
 * all before a `.where()` with a condition. Builders it returns are sealed the same way. Methods run on the builder
 * itself, so Drizzle's own calls inside them are untouched.
 */
function seal<B extends object>(builder: B, alive: () => void, write?: string): B {
  let filtered = write === undefined;
  const proxy: B = new Proxy(builder, {
    set: sealed,
    defineProperty: sealed,
    deleteProperty: sealed,
    setPrototypeOf: sealed,
    get(target, prop) {
      if (hidden(prop)) return undefined;
      const value: unknown = (target as Record<PropertyKey, unknown>)[prop];
      if (write !== undefined && prop === 'where') {
        return (cond: SQL | undefined) => {
          if (cond === undefined) throw unbounded(write);
          (value as (c: SQL) => unknown).call(target, cond);
          filtered = true;
          return proxy;
        };
      }
      if (typeof value !== 'function') return value;
      if (RUNS.has(prop)) {
        const refusal = () => (filtered ? (alive(), undefined) : unbounded(write ?? 'A write'));
        return (...args: unknown[]) => {
          let refused: Error | undefined;
          try {
            refused = refusal();
          } catch (e) {
            refused = e as Error;
          }
          if (refused === undefined) return (value as (...a: unknown[]) => unknown).apply(target, args);
          if (prop === 'prepare' || prop === '_prepare') throw refused;
          // then, catch, finally and execute answer with a rejected promise, as a failed query would.
          const rejected = Promise.reject(refused);
          return prop === 'then' ? rejected.then(...(args as [undefined, undefined]))
            : prop === 'catch' ? rejected.catch(args[0] as undefined)
              : prop === 'finally' ? rejected.finally(args[0] as undefined) : rejected;
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result === target) return proxy;
        return isBuilder(result) ? seal(result, alive, filtered ? undefined : write) : result;
      };
    },
  });
  return proxy;
}

type Relational = { table: unknown; findMany: (c?: QueryConfig) => object; findFirst: (c?: QueryConfig) => object };

/** A module's transaction, from its own tables and relations. Its entry exports the result as `<module>Tx`. */
export function moduleTx<S extends Record<string, unknown>>(schema: S): (ctx: { readonly tx: Tx }) => ModuleTx<S> {
  // A table answers getTableName; a relations object doesn't.
  const isTable = (v: unknown): v is PgTable => typeof v === 'object' && v !== null && typeof getTableName(v as PgTable) === 'string';
  const keys = Object.keys(schema).filter((k) => isTable(schema[k]));
  const tables = new Set(keys.map((k) => schema[k]));
  const own = <T>(table: T): T => {
    if (!tables.has(table)) {
      const name = isTable(table) ? getTableName(table) : 'that object';
      throw new ForeignTableError(`${name} isn't one of this module's tables`);
    }
    return table;
  };

  // The handle is looked up on every call, so a module object or builder kept past its transaction refuses to run.
  const make = (handle: Tx): ModuleTx<S> => {
    const raw = () => rawOf(handle);
    const alive = () => void raw();
    // The client's query.<key> must be this module's own table, not another module's under the same key.
    const relational = (k: string): Relational => {
      const rq = (raw().query as unknown as Record<string, Relational | undefined>)[k];
      if (rq === undefined || rq.table !== schema[k]) throw new ForeignTableError(`query.${k} isn't this module's ${k} table`);
      return rq;
    };
    const query = Object.freeze(Object.fromEntries(keys.map((k) => [k, Object.freeze({
      findMany: (c?: QueryConfig) => seal(relational(k).findMany(safeConfig(c)), alive),
      findFirst: (c?: QueryConfig) => seal(relational(k).findFirst(safeConfig(c)), alive),
    })])));
    return Object.freeze({
      query,
      select: ((...a: Parameters<RawTx['select']>) => seal(raw().select(...a), alive)) as RawTx['select'],
      insert: (table) => seal(raw().insert(own(table)), alive),
      update: (table) => seal(raw().update(own(table)), alive, 'An update'),
      delete: (table) => seal(raw().delete(own(table)), alive, 'A delete'),
      // The savepoint gets its own handle, dead once the savepoint ends.
      transaction: (cb) => raw().transaction(async (savepoint) => {
        const inner = bind(savepoint as RawTx);
        try {
          return await cb(make(inner));
        } finally {
          unbind(inner);
        }
      }),
    } as ModuleTx<S>);
  };
  return (ctx) => {
    rawOf(ctx.tx);
    return make(ctx.tx);
  };
}
