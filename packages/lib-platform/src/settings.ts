// Typed settings (M1-30, RC-161). A library declares each of its settings once, with a zod schema and the value used
// when nobody has set it; the `settings` table (packages/db/src/platform/tables.ts) stores only what an admin
// changed, as JSON. A request reads every row once, when its Ctx is built (M1-08), and services get typed values from
// that one read: no setting is fetched twice in a request, and no request sees a half-applied change.
import type { z } from 'zod';
import type { Ctx } from './ctx.ts';

const KEY = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;

/** What the settings screen offers for a setting (ADR-001 §8c): a field of its kind, a choice of fixed values, or a
 * pick of one record of a kind (`reference`, such as a price list). */
export type SettingInput =
  | Readonly<{ kind: 'money' | 'percent' | 'integer' | 'text' | 'yes_no' }>
  | Readonly<{ kind: 'choice'; choices: readonly Readonly<{ value: string; label: string }>[] }>
  | Readonly<{ kind: 'reference'; record: string }>;

/** A setting's label and description for the screen, its input, and what a schema can't check, run on a change (a
 * price list that exists and is active): the refusal's message, or null. */
export type SettingMeta<T> = Readonly<{
  label: string;
  description: string;
  input: SettingInput;
  check?(ctx: Ctx, value: T): Promise<string | null>;
}>;

/** One setting: its key (`<module>.<name>`, the same pattern as the table's CHECK), schema, default and meta. */
export type SettingDef<T> = Readonly<{ key: string; schema: z.ZodType<T>; fallback: T } & SettingMeta<T>>;

// Every setting declared in this process, by key: the tools test checks apps/api composes each one (ADR-001 §8c).
const declared = new Set<string>();

/** Declares a setting. Throws at load time on a bad key, a default its own schema refuses, or no label or description. */
export function defineSetting<T>(key: string, schema: z.ZodType<T>, fallback: T, meta: SettingMeta<T>): SettingDef<T> {
  if (!KEY.test(key)) throw new TypeError(`Setting key "${key}" must be <module>.<name> in lower case`);
  schema.parse(fallback);
  if (meta.label.trim() === '' || meta.description.trim() === '') throw new TypeError(`Setting ${key} needs a label and a description`);
  const def: SettingDef<T> = Object.freeze({ key, schema, fallback, ...meta });
  declared.add(key);
  return def;
}

/** The keys of every setting declared so far in this process (for the composition test). */
export const declaredSettingKeys = (): readonly string[] => [...declared].toSorted();

/** A stored row, as the settings table gives it. */
export type SettingRow = { key: string; value: unknown };

/** The settings one request sees: read once, then answered from memory. */
export class Settings {
  readonly #rows: ReadonlyMap<string, unknown>;

  constructor(rows: readonly SettingRow[]) {
    this.#rows = new Map(rows.map((r) => [r.key, r.value]));
  }

  /** The stored value, checked by the setting's schema; its default when none is stored. A stored value its schema
   * now refuses (the setting's shape changed) throws, so it is fixed rather than silently ignored. */
  get<T>(def: SettingDef<T>): T {
    if (!this.#rows.has(def.key)) return def.fallback;
    const r = def.schema.safeParse(this.#rows.get(def.key));
    if (!r.success) throw new TypeError(`The stored value of setting ${def.key} no longer fits its schema`);
    return r.data;
  }
}

/** The row to store for a new value, checked first, so a bad value never reaches the table. */
export function settingRow<T>(def: SettingDef<T>, value: T): SettingRow {
  return { key: def.key, value: def.schema.parse(value) };
}
