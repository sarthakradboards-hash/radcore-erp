// Typed settings (M1-30, RC-161). A library declares each of its settings once, with a zod schema and the value used
// when nobody has set it; the `settings` table (packages/db/src/platform/tables.ts) stores only what an admin
// changed, as JSON. A request reads every row once, when its Ctx is built (M1-08), and services get typed values from
// that one read: no setting is fetched twice in a request, and no request sees a half-applied change.
import { z } from 'zod';

const KEY = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;

/** One setting: its key (`<module>.<name>`, the same pattern as the table's CHECK), schema and default. */
export type SettingDef<T> = Readonly<{ key: string; schema: z.ZodType<T>; fallback: T }>;

/** Declares a setting. Throws at load time on a bad key or a default its own schema refuses. */
export function defineSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): SettingDef<T> {
  if (!KEY.test(key)) throw new TypeError(`Setting key "${key}" must be <module>.<name> in lower case`);
  schema.parse(fallback);
  return Object.freeze({ key, schema, fallback });
}

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
