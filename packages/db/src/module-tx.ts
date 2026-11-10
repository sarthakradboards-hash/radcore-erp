// The module transaction (ADR-002 §4, ADR-001 §5 T1): a runtime object, not a type alias. Each module's entry
// (`@radcore/db/<module>`) builds one from its own tables, `salesTx = moduleTx({ ...tables, ...relations })`, and only
// that module's library may import it (D7). It wraps the request's transaction and exposes only:
// - `query.<own table>`: relational reads, whose where and orderBy callbacks get operators without `sql` or
//   `notInArray`, and which refuse `extras` (raw SQL);
// - `select()`: the query builder;
// - `insert`, `update`, `delete`: own tables only, by type and at run time; an update or delete must have a filter;
// - `transaction(cb)`: a savepoint, whose `cb` gets a module transaction again.
// It has no `execute`, `_`, `$with` or driver handle: those members don't exist on the object, so no cast reaches them.
import { getOperators, getOrderByOperators, getTableName, type ExtractTablesWithRelations, type SQL } from 'drizzle-orm';
import type { PgDeleteBase, PgInsertBuilder, PgQueryResultHKT, PgTable, PgUpdateBuilder } from 'drizzle-orm/pg-core';
import type { RelationalQueryBuilder } from 'drizzle-orm/pg-core/query-builders/query';
import { rawOf, type RawTx, type Tx } from './tx.ts';

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

// An update or delete builder that refuses `.where(undefined)`, and refuses to run before `.where()`.
function bounded<B extends object>(builder: B, what: string): B {
  let filtered = false;
  const proxy: B = new Proxy(builder, {
    get(target, prop) {
      const value: unknown = (target as Record<PropertyKey, unknown>)[prop];
      if (prop === 'where') {
        return (cond: SQL | undefined) => {
          if (cond === undefined) throw unbounded(what);
          filtered = true;
          (value as (c: SQL) => unknown).call(target, cond);
          return proxy;
        };
      }
      if (typeof value !== 'function') return value;
      if (!filtered && (prop === 'then' || prop === 'execute')) {
        return (...args: unknown[]) => Promise.reject(unbounded(what)).then(...(args as [undefined, undefined]));
      }
      if (!filtered && prop === 'prepare') return () => { throw unbounded(what); };
      return (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

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

  const make = (raw: RawTx): ModuleTx<S> => {
    const relational = raw.query as unknown as Record<string, { findMany: (c?: QueryConfig) => unknown; findFirst: (c?: QueryConfig) => unknown }>;
    const query = Object.freeze(Object.fromEntries(keys.map((k) => [k, Object.freeze({
      findMany: (c?: QueryConfig) => relational[k]?.findMany(safeConfig(c)),
      findFirst: (c?: QueryConfig) => relational[k]?.findFirst(safeConfig(c)),
    })])));
    return Object.freeze({
      query,
      select: ((...a: Parameters<RawTx['select']>) => raw.select(...a)) as RawTx['select'],
      insert: (table) => raw.insert(own(table)),
      update: (table) => {
        const builder = raw.update(own(table));
        return { set: (values: never) => bounded(builder.set(values), 'An update') } as unknown as ReturnType<typeof raw.update>;
      },
      delete: (table) => bounded(raw.delete(own(table)), 'A delete'),
      transaction: (cb) => raw.transaction((savepoint) => cb(make(savepoint as RawTx))),
    } as ModuleTx<S>);
  };
  return (ctx) => make(rawOf(ctx.tx));
}
