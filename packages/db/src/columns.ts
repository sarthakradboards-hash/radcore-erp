// Column helpers and the table wrapper every table is declared with (ADR-005 §1, §3 to §5). SQL zone (ADR-002 §3):
// `sql` appears only as a CHECK's, a default's or a generated column's argument.
import { sql } from 'drizzle-orm';
import type { BuildExtraConfigColumns } from 'drizzle-orm';
import { boolean, check, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { PgColumnBuilderBase, PgTableExtraConfigValue } from 'drizzle-orm/pg-core';

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
/** A quantity: `> 0` on a document line (`{ line: true }`), `>= 0` elsewhere. */
export const qty = (o: { line?: boolean } = {}) =>
  withRule(numeric({ precision: 18, scale: 3 }), { op: o.line ? 'gt0' : 'min0' });
/** A rate in percent, `between 0 and 100`, or up to `max` where the law allows more (a cess rate). */
export const percent = (o: { max?: number } = {}) =>
  withRule(numeric({ precision: 9, scale: 6 }), { op: 'between', max: o.max ?? 100 });
/** An exchange rate, `> 0`. */
export const fxRate = () => withRule(numeric({ precision: 18, scale: 8 }), { op: 'gt0' });
/** Text a person types: at most `max` characters (200 by default). */
export const boundedText = (o: { max?: number } = {}) => withRule(text(), { op: 'length', max: o.max ?? 200 });
/** A document's, ledger's or master's id. */
export const id = () => uuid().primaryKey().defaultRandom();

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

// drizzle-orm's own snake_case rule (its casing.ts), so `ck_<table>_<column>` names the column Drizzle writes.
const snake = (key: string) =>
  (key.replace(/['’]/g, '').match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((w) => w.toLowerCase()).join('_');

/**
 * Every table: the four audit columns (ADR-005 §5), and the CHECK of each helper column, named `ck_<table>_<column>`
 * (§1). Each numeric CHECK also refuses 'NaN', which `>= 0` would let through.
 */
export const radcoreTable = <TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns,
  extras?: (t: BuildExtraConfigColumns<TName, TColumns & Audit, 'pg'>) => PgTableExtraConfigValue[],
) => pgTable(name, { ...columns, ...audit() }, (t) => [
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
 * `stores` can't both exist (RC-044); `label_key` drops case.
 */
export const lookupTable = <TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns = {} as TColumns,
) => radcoreTable(name, {
  code: text().primaryKey(),
  label: boundedText().notNull(),
  active: boolean().notNull().default(true),
  codeKey: text().notNull().generatedAlwaysAs(sql`regexp_replace(replace(lower(code), '_', ''), 's$', '')`),
  labelKey: text().notNull().generatedAlwaysAs(sql`lower(label)`),
  ...columns,
}, (t) => [
  check(`ck_${name}_code`, sql`${t.code} ~ '^[a-z][a-z0-9_]*$'`),
  uniqueIndex(`ux_${name}_code_key`).on(t.codeKey),
  uniqueIndex(`ux_${name}_label_key`).on(t.labelKey),
]);
