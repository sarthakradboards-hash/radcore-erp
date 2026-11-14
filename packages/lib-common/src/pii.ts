// Personal data (ADR-001 §7a, M1-22, RAD-40). A contract marks an output field pii(); the generic handler masks it on
// the declared output for a principal without the key it needs, and logs who saw it unmasked. Pure, so the browser's
// kit tests a value with the same isMasked.
import { z } from 'zod';

/** Personal data needs pii:read. Salaries and bank details are `pay` and need pay:read, which only admin and owner
 * hold (D-20): pii:read alone still sees them masked. */
export type PiiKind = 'personal' | 'pay';
/** A value the server hid from this principal, as the wire sends it. */
export type Masked = { masked: string };

const masked = z.object({ masked: z.string() }).strict();
const KEY: Readonly<Record<PiiKind, string>> = { personal: 'pii:read', pay: 'pay:read' };
const BULLETS = '••••••';
/** Whether a principal holding these keys sees this kind of data unmasked. */
export const maySee = (kind: PiiKind, permissions: readonly string[]): boolean => permissions.includes(KEY[kind]);

/** The fields the handler masks. */
export const piiFields = z.registry<{ kind: PiiKind }>();
/** An output field holding personal data: its value, or `{ masked }` for a principal who may not see it, so every
 * screen's type has to handle both. Inputs never use it: an edit leaves out what it can't see (patch semantics). */
export function pii<T extends z.ZodType = z.ZodString>(schema?: T, kind: PiiKind = 'personal') {
  const field = z.union([(schema ?? z.string()) as T, masked]);
  piiFields.add(field as z.ZodType, { kind });
  return field;
}
export const isMasked = (value: unknown): value is Masked => masked.safeParse(value).success;

/** Six bullets whatever the length, so a mask gives no length away; personal data longer than 6 characters keeps its
 * last 4 ("••••••3210"), and pay keeps nothing. */
export function maskOf(value: unknown, kind: PiiKind): Masked {
  const chars = [...String(value)];
  return { masked: kind === 'personal' && chars.length > 6 ? BULLETS + chars.slice(-4).join('') : BULLETS };
}

/** Where the pii() fields are in an output schema. */
export type PiiPlan = { kind: PiiKind } | { fields: Readonly<Record<string, PiiPlan>> } | { each: PiiPlan };

// Every schema a schema holds, whatever its kind: zod keeps them on its def (shape, element, options, innerType…).
function children(s: z.ZodType): z.ZodType[] {
  const def: object = s._zod.def;
  return Object.values(def).flatMap((v: unknown) => {
    if (v instanceof z.ZodType) return [v];
    const many: unknown[] = Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : [];
    return many.filter((c): c is z.ZodType => c instanceof z.ZodType);
  });
}
const holdsPii = (s: z.ZodType): boolean => piiFields.has(s) || children(s).some(holdsPii);

function merge(a: PiiPlan, b: PiiPlan): PiiPlan {
  if ('fields' in a && 'fields' in b) {
    const fields: Record<string, PiiPlan> = { ...a.fields };
    for (const [k, p] of Object.entries(b.fields)) fields[k] = fields[k] === undefined ? p : merge(fields[k], p);
    return { fields };
  }
  if ('each' in a && 'each' in b) return { each: merge(a.each, b.each) };
  if ('kind' in a && 'kind' in b) return a.kind === 'pay' ? a : b;
  throw new TypeError('a union whose options hold pii() at the same place in different shapes can\'t be masked');
}

/** The output's pii() fields, or null when it has none. A pii() field under a wrapper this can't follow (a record,
 * a tuple, a pipe) refuses, so no field goes unmasked because the walk missed it. */
export function piiPlan(schema: z.ZodType): PiiPlan | null {
  const meta = piiFields.get(schema);
  if (meta !== undefined) return { kind: meta.kind };
  if (!holdsPii(schema)) return null;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodReadonly
    || schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault || schema instanceof z.ZodNonOptional
    || schema instanceof z.ZodCatch) return piiPlan(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodArray) return { each: piiPlan(schema.element as z.ZodType) as PiiPlan };
  if (schema instanceof z.ZodObject) {
    const fields: Record<string, PiiPlan> = {};
    for (const [k, s] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const p = piiPlan(s);
      if (p !== null) fields[k] = p;
    }
    return { fields };
  }
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodType[]).map(piiPlan).filter((p): p is PiiPlan => p !== null).reduce(merge);
  }
  throw new TypeError(`a pii() field under a ${schema._zod.def.type} can't be masked: use an object or an array`);
}

type Seen = { looks: Set<string>; unattributed: boolean };
function walk(plan: PiiPlan, value: unknown, may: (k: PiiKind) => boolean, record: string | undefined, seen: Seen): unknown {
  if (value === null || value === undefined) return value;
  if ('kind' in plan) {
    if (isMasked(value)) return value;
    if (!may(plan.kind)) return maskOf(value, plan.kind);
    if (record === undefined) seen.unattributed = true;
    else seen.looks.add(record);
    return value;
  }
  if ('each' in plan) return Array.isArray(value) ? value.map((v) => walk(plan.each, v, may, record, seen)) : value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  // The record is the outermost object with an id: a value reached through a relation is a look at that record.
  const here = record ?? (typeof object['id'] === 'string' ? object['id'] : undefined);
  const out = { ...object };
  for (const [k, p] of Object.entries(plan.fields)) if (k in out) out[k] = walk(p, out[k], may, here, seen);
  return out;
}

/**
 * The output as this principal may see it, and the records they saw unmasked (ADR-005 §7c): the ids of the outermost
 * objects holding an unmasked value, once each. `unattributed` says an unmasked value had no record id around it, so
 * its look couldn't be logged.
 */
export function maskOutput(plan: PiiPlan, value: unknown, permissions: readonly string[]):
  { value: unknown; looks: string[]; unattributed: boolean } {
  const seen: Seen = { looks: new Set(), unattributed: false };
  const shown = walk(plan, value, (k) => maySee(k, permissions), undefined, seen);
  return { value: shown, looks: [...seen.looks], unattributed: seen.unattributed };
}

/** Where an input holds a value shaped like a mask (a string starting with •, or `{ masked }`), or null. A write
 * refuses it, so a masked value is never saved over the real one (ADR-001 §7a). */
export function maskedInputPath(value: unknown, path: (string | number)[] = []): (string | number)[] | null {
  if (typeof value === 'string') return value.startsWith('•') ? path : null;
  if (isMasked(value)) return path;
  if (typeof value !== 'object' || value === null) return null;
  for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    const found = maskedInputPath(v, [...path, k]);
    if (found !== null) return found;
  }
  return null;
}
