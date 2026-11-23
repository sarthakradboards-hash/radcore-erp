// Column helpers and the table wrapper every table is declared with (ADR-005 §1, §3 to §5). SQL zone (ADR-002 §3):
// `sql` appears only as a CHECK's, a default's or a generated column's argument.
import { sql } from 'drizzle-orm';
import type { BuildExtraConfigColumns } from 'drizzle-orm';
import { boolean, check, customType, index, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ExtraConfigColumn, PgColumnBuilderBase, PgTableExtraConfigValue } from 'drizzle-orm/pg-core';

/** The one schema every table and view lives in (ADR-005 §7c); the trigger functions' search_path names it, `public` is unused. */
export const radcore = pgSchema('radcore');

// The CHECK a helper column carries. radcoreTable reads it back, because Drizzle 0.45's check() is table-level and a
// column builder doesn't know its table.
type Rule = { op: 'min0' | 'gt0' | 'notNaN' } | { op: 'between' | 'length'; max: number };
const rules = new WeakMap<object, Rule>();
const withRule = <T extends object>(builder: T, rule: Rule): T => {
  rules.set(builder, rule);
  return builder;
};

/** Rupees, `numeric(18,2)`: `>= 0`, or any sign with `{ signed: true }` (round-off, adjustments, balances). */
export const money = (o: { signed?: boolean } = {}) =>
  withRule(numeric({ precision: 18, scale: 2 }), { op: o.signed ? 'notNaN' : 'min0' });
/** An amount in the document's own currency, as entered (RC-009). */
export const foreignMoney = () => withRule(numeric({ precision: 18, scale: 4 }), { op: 'min0' });
/** A rate per unit, stored exactly: 0.375, or a foreign unit price (RC-008). */
export const unitPrice = () => withRule(numeric({ precision: 18, scale: 6 }), { op: 'min0' });
/** A quantity: `> 0` on a document line (`{ line: true }`), `>= 0` elsewhere, or either sign (`{ signed: true }`: a
 * count's book quantity and difference, RAD-141). */
export const qty = (o: { line?: boolean; signed?: boolean } = {}) =>
  withRule(numeric({ precision: 18, scale: 3 }), { op: o.signed ? 'notNaN' : o.line ? 'gt0' : 'min0' });
/** A rate in percent, `between 0 and 100`, or up to `max` where the law allows more (a cess rate). */
export const percent = (o: { max?: number } = {}) =>
  withRule(numeric({ precision: 9, scale: 6 }), { op: 'between', max: o.max ?? 100 });
/** An exchange rate, `> 0`. */
export const fxRate = () => withRule(numeric({ precision: 18, scale: 8 }), { op: 'gt0' });
/** Text a person types: at most `max` characters (200 by default). */
export const boundedText = (o: { max?: number } = {}) => withRule(text(), { op: 'length', max: o.max ?? 200 });
/** A document's, ledger's or master's id. */
export const id = () => uuid().primaryKey().defaultRandom();
/** A jsonb value that may be a bare string (a setting). drizzle's jsonb() parses what node-pg already parsed a second
 * time, so a stored "2024" came back as 2024 and "null" as null (RAD-98); this one writes JSON and reads it once. */
export const json = customType<{ data: unknown; driverData: unknown }>({ dataType: () => 'jsonb', toDriver: (v) => JSON.stringify(v) });

// The principal from the request context (ADR-002 request-context.ts). Until the audit triggers (M1-12) overwrite it,
// a write with no principal fails here on NOT NULL, instead of being recorded as nobody.
const principal = () => text().notNull().default(sql`nullif(current_setting('app.principal', true), '')`);
const audit = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: principal(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: principal(),
});
type Audit = ReturnType<typeof audit>;

/** `created_at` as PostgreSQL's text, for a table whose list pages on it: the same column, read so the page key keeps its
 * microseconds (lib-platform's momentKey). A table restates it in its columns; the database sees no change. */
const moments = new WeakSet<object>();
export const createdMoment = () => {
  const builder = timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow();
  moments.add(builder);
  return builder;
};

/** A table may restate an audit column only as createdMoment()'s createdAt: the database's guard counts the four
 * columns but not their type, NOT NULL or default, so anything else is refused here, as the module loads (auditor-2 on
 * #316). */
function restatedOnlyAsMoment<T extends Record<string, PgColumnBuilderBase>>(name: string, columns: T): T {
  for (const key of Object.keys(audit())) {
    const builder = columns[key];
    if (builder !== undefined && !(key === 'createdAt' && moments.has(builder))) {
      throw new Error(`${name}: ${key} is an audit column; only createdAt may be restated, as createdMoment()`);
    }
  }
  return columns;
}

// drizzle-orm's own snake_case rule (its casing.ts), so `ck_<table>_<column>` names the column Drizzle writes.
const snake = (key: string) =>
  (key.replace(/['’]/g, '').match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((w) => w.toLowerCase()).join('_');

/**
 * Every table, in the `radcore` schema: the four audit columns (ADR-005 §5), and the CHECK of each helper column, named `ck_<table>_<column>`
 * (§1). Each numeric CHECK also refuses 'NaN', which `>= 0` would let through.
 */
export const radcoreTable = <TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns,
  extras?: (t: BuildExtraConfigColumns<TName, Omit<Audit, keyof TColumns> & TColumns, 'pg'>) => PgTableExtraConfigValue[],
) => radcore.table(name, { ...audit(), ...restatedOnlyAsMoment(name, columns) } as Omit<Audit, keyof TColumns> & TColumns, (t) => [
  ...Object.entries(columns).flatMap(([key, builder]) => {
    const rule = rules.get(builder);
    const c = t[key as keyof typeof t];
    const ck = `ck_${name}_${snake(key)}`;
    switch (rule?.op) {
      case 'min0': return [check(ck, sql`${c} >= 0 and ${c} <> 'NaN'`)];
      case 'gt0': return [check(ck, sql`${c} > 0 and ${c} <> 'NaN'`)];
      case 'notNaN': return [check(ck, sql`${c} <> 'NaN'`)];
      case 'between': return [check(ck, sql`${c} between 0 and ${rule.max} and ${c} <> 'NaN'`.inlineParams())];
      case 'length': return [check(ck, sql`char_length(${c}) <= ${rule.max}`.inlineParams())];
      default: return [];
    }
  }),
  ...(extras?.(t) ?? []),
]);

/**
 * A list that grows or that people edit (ADR-005 §4): `code` (a pattern CHECK), `label`, `active`. Two generated keys,
 * each with a unique index, keep names apart: `code_key` drops case, underscores and one trailing `s`, so `store` and
 * `stores` can't both exist (RC-044); `label_key` drops case and folds runs of whitespace, so `Store  Room ` is `store room`.
 */
export const lookupTable = <TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns = {} as TColumns,
) => radcoreTable(name, {
  code: text().primaryKey(),
  label: boundedText().notNull(),
  active: boolean().notNull().default(true),
  codeKey: text().notNull().generatedAlwaysAs(sql`regexp_replace(replace(lower(code), '_', ''), 's$', '')`),
  labelKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g')))`),
  ...columns,
}, (t) => [
  check(`ck_${name}_code`, sql`${t.code} ~ '^[a-z][a-z0-9_]*$'`),
  uniqueIndex(`ux_${name}_code_key`).on(t.codeKey),
  uniqueIndex(`ux_${name}_label_key`).on(t.labelKey),
]);

/**
 * A trigram index on a searched text column, for a table's extra config: `trigramIndex('ix_parties_name_trgm', t.name)`.
 * lists.ts's searchWords (ILIKE '%…%') can then use it instead of reading every row (RC-160). pg_trgm is in its own
 * schema, radcore_ext (ADR-005 §7c, migration 0006_pg_trgm), so the operator class is named with it.
 */
export const trigramIndex = (name: string, column: ExtraConfigColumn) =>
  index(name).using('gin', column.op('radcore_ext.gin_trgm_ops'));
