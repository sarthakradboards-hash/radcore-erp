// A setting as a library declares it (M1-30, RAD-132, ADR-001 §8c): its key, schema and default (settings.ts), and what
// the settings screen shows of it: a label, a description, the input it offers, and a check a schema can't make.
import type { z } from 'zod';
import type { Ctx } from './ctx.ts';
import { checkSetting, type StoredSetting } from './settings.ts';

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
export type SettingDef<T> = StoredSetting<T> & SettingMeta<T>;

// Every setting declared in this process, by key: the tools test checks apps/api composes each one (ADR-001 §8c).
const declared = new Set<string>();

/** Declares a setting. Throws at load time on a bad key, a default its own schema refuses, or no label or description. */
export function defineSetting<T>(key: string, schema: z.ZodType<T>, fallback: T, meta: SettingMeta<T>): SettingDef<T> {
  checkSetting(key, schema, fallback);
  if (meta.label.trim() === '' || meta.description.trim() === '') throw new TypeError(`Setting ${key} needs a label and a description`);
  const def: SettingDef<T> = Object.freeze({ key, schema, fallback, ...meta });
  declared.add(key);
  return def;
}

/** The keys of every setting declared so far in this process (for the composition test). */
export const declaredSettingKeys = (): readonly string[] => [...declared].toSorted();
