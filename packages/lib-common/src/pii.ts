// Personal data (ADR-001 §7a, ADR-005 §7c, M1-22, RAD-40). An output field is marked pii() inside an object schema
// marked piiRecord(table, …); the generic handler masks the field for a principal without the key it needs, and logs
// each record shown unmasked against its table. Pure, so the browser's kit tests a value with the same isMasked.
import { z } from 'zod';

/** How a field is masked: whole (names, addresses, emails), keeping the last 4 of an identifier like a phone, PAN or
 * account number, or whole as pay. Pay (salaries, bank details) needs pay:read, which only admin and owner hold (D-20):
 * pii:read alone still sees it masked. A cost (a purchase price, a valuation) is masked whole without cost:read
 * (RAD-89): it isn't personal data, so it needs no record and logs no look. */
export type PiiKind = 'whole' | 'last4' | 'pay' | 'cost';
/** A value the server hid from this principal, as the wire sends it. */
export type Masked = { masked: string };

const maskShape = () => z.object({ masked: z.string() }).strict();
const masked = maskShape();
// One mask schema per kind, as a pii() field's second option. zod's copies (.describe(), .meta(), .refine(), and the
// wrappers) keep a union's options, so a field is known by its mask wherever a copy of it goes (the auditor on #156).
const MASKS: Readonly<Record<PiiKind, z.ZodType>> = { whole: maskShape(), last4: maskShape(), pay: maskShape(), cost: maskShape() };
const MASK_KINDS = new Map<z.ZodType, PiiKind>(Object.entries(MASKS).map(([k, s]) => [s, k as PiiKind]));
/** The mask is always six bullets, so it gives no length away. */
const BULLETS = '••••••';
/**
 * Whether this request may be shown a kind of personal data, given the key, if any, the record names for its own
 * fields (`seenWith`, RAD-90). The one answer the handler's mask and every service ask (`ctx.shows`), so the two can't
 * disagree (the auditor on #166). A request that isn't direct (Sec-Fetch-Site not same-origin or none, ADR-005 §7c) is
 * shown nothing; pay needs pay:read and nothing else (D-20), and a cost cost:read and nothing else (RAD-89).
 */
export type Sight = (kind: PiiKind, seenWith?: string) => boolean;
/** The Sight of a principal holding these keys; `direct` is false for a request the browser says came from elsewhere. */
export const sightOf = (permissions: readonly string[], direct = true): Sight => (kind, seenWith) =>
  direct && (kind === 'pay' ? permissions.includes('pay:read') : kind === 'cost' ? permissions.includes('cost:read')
    : permissions.includes('pii:read') || (seenWith !== undefined && permissions.includes(seenWith)));

/** The object schemas that are records: a look at one is logged against its table, and `seenWith` names one more key
 * that shows its own whole and last4 fields. */
export const piiRecords = z.registry<{ table: string; seenWith?: string }>();

/** An output field holding personal data: its value, or `{ masked }` for a principal who may not see it, so every
 * screen's type has to handle both. It sits inside a piiRecord. Inputs never use it: an edit leaves out what it can't
 * see (patch semantics). */
export function pii<T extends z.ZodType = z.ZodString>(schema?: T, kind: PiiKind = 'whole') {
  return z.union([(schema ?? z.string()) as T, MASKS[kind] as typeof masked]);
}
/** An output field holding a cost (RAD-89): its value, or `{ masked }` without cost:read. Unlike pii() it may sit
 * anywhere in an answer, and showing it logs no look: a cost isn't anyone's personal data. */
export function cost<T extends z.ZodType = z.ZodString>(schema?: T) {
  return z.union([(schema ?? z.string()) as T, MASKS.cost as typeof masked]);
}
/** An object schema holding pii() fields, and the table its records are in, so a customer reached through an order
 * is logged against `customers`. It has an `id`, the record's. `seenWith` names one more key that shows this record's
 * own whole and last4 fields, never a record nested in it or pay (`parties:contact`, RAD-90). */
export function piiRecord<S extends z.ZodRawShape & { id: z.ZodType }>(table: string, schema: z.ZodObject<S>,
  { seenWith }: { seenWith?: string } = {}): z.ZodObject<S> {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new TypeError(`piiRecord: ${table} isn't a table's name`);
  if (seenWith !== undefined && !/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(seenWith)) {
    throw new TypeError(`piiRecord: ${seenWith} isn't a permission key`);
  }
  piiRecords.add(schema as z.ZodType, { table, ...(seenWith === undefined ? {} : { seenWith }) });
  return schema;
}
export const isMasked = (value: unknown): value is Masked => masked.safeParse(value).success;

/** Six bullets; `last4` keeps the last 4 characters of a value with at least 8 ("••••••3210"). */
export function maskOf(value: unknown, kind: PiiKind): Masked {
  const chars = [...String(value)];
  return { masked: kind === 'last4' && chars.length >= 8 ? BULLETS + chars.slice(-4).join('') : BULLETS };
}

/** Where the pii() fields are in an output schema, and the records they belong to. */
export type PiiPlan = { kind: PiiKind } | { fields: Readonly<Record<string, PiiPlan>>; table?: string; seenWith?: string }
  | { each: PiiPlan };

/** A pii() field's kind, from its mask option, or undefined for any other schema. */
const kindOf = (s: z.ZodType): PiiKind | undefined =>
  s instanceof z.ZodUnion ? (s.options as z.ZodType[]).map((o) => MASK_KINDS.get(o)).find((k) => k !== undefined) : undefined;

// Every schema a schema holds, whatever its kind: zod keeps them on its def (shape, element, options, innerType…), and
// a lazy behind its getter.
function children(s: z.ZodType): z.ZodType[] {
  if (s instanceof z.ZodLazy) return [s.unwrap() as z.ZodType];
  const def: object = s._zod.def;
  return Object.values(def).flatMap((v: unknown) => {
    if (v instanceof z.ZodType) return [v];
    const many: unknown[] = Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : [];
    return many.filter((c): c is z.ZodType => c instanceof z.ZodType);
  });
}
// A def can point back at its own schema (a lazy, a clone's parent), so each schema is visited once.
function holdsPii(s: z.ZodType, seen = new Set<z.ZodType>()): boolean {
  if (seen.has(s)) return false;
  seen.add(s);
  return kindOf(s) !== undefined || children(s).some((c) => holdsPii(c, seen));
}

function merge(a: PiiPlan, b: PiiPlan): PiiPlan {
  if ('fields' in a && 'fields' in b) {
    if (a.table !== b.table || a.seenWith !== b.seenWith) {
      throw new TypeError('a union of records from different tables, or seen with different keys, can\'t be logged');
    }
    const fields: Record<string, PiiPlan> = { ...a.fields };
    for (const [k, p] of Object.entries(b.fields)) fields[k] = fields[k] === undefined ? p : merge(fields[k], p);
    return { fields, ...(a.table === undefined ? {} : { table: a.table }), ...(a.seenWith === undefined ? {} : { seenWith: a.seenWith }) };
  }
  if ('each' in a && 'each' in b) return { each: merge(a.each, b.each) };
  if ('kind' in a && 'kind' in b && a.kind === b.kind) return a;
  throw new TypeError('a union whose options hold pii() at the same place in different shapes can\'t be masked');
}

function planOf(schema: z.ZodType, inRecord: boolean): PiiPlan | null {
  const kind = kindOf(schema);
  if (kind !== undefined) {
    if (!inRecord && kind !== 'cost') throw new TypeError('a pii() field sits outside any piiRecord, so its look has no table to log under');
    return { kind };
  }
  if (!holdsPii(schema)) return null;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodReadonly
    || schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault || schema instanceof z.ZodNonOptional
    || schema instanceof z.ZodCatch) return planOf(schema.unwrap() as z.ZodType, inRecord);
  if (schema instanceof z.ZodArray) return { each: planOf(schema.element as z.ZodType, inRecord) as PiiPlan };
  if (schema instanceof z.ZodObject) {
    const record = piiRecords.get(schema);
    const table = record?.table;
    const shape = schema.shape as Record<string, z.ZodType>;
    if (table !== undefined && shape['id'] === undefined) throw new TypeError(`a piiRecord of ${table} has no id`);
    const fields: Record<string, PiiPlan> = {};
    for (const [k, s] of Object.entries(shape)) {
      const p = planOf(s, inRecord || table !== undefined);
      if (p !== null) fields[k] = p;
    }
    return { fields, ...(table === undefined ? {} : { table }), ...(record?.seenWith === undefined ? {} : { seenWith: record.seenWith }) };
  }
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodType[]).map((o) => planOf(o, inRecord)).filter((p): p is PiiPlan => p !== null).reduce(merge);
  }
  throw new TypeError(`a pii() field under a ${schema._zod.def.type} can't be masked: use an object or an array`);
}
/** The output's pii() fields, or null when it has none. It refuses a pii() field outside a piiRecord, a piiRecord
 * without an id, and a pii() field under a wrapper it can't follow (a record, a tuple, a pipe, a lazy), so no field goes
 * unmasked or unlogged because the walk missed it. */
export const piiPlan = (schema: z.ZodType): PiiPlan | null => planOf(schema, false);

/** A record shown with at least one unmasked pii() value. */
export type Look = { table: string; id: string };
type Record_ = { table: string; id: unknown; seenWith?: string } | undefined;
function walk(plan: PiiPlan, value: unknown, may: Sight, record: Record_, looks: Map<string, Look>): unknown {
  if (value === null || value === undefined) return value;
  if ('kind' in plan) {
    if (isMasked(value)) return value;
    if (!may(plan.kind, record?.seenWith)) return maskOf(value, plan.kind);
    if (plan.kind === 'cost') return value;
    // The output check has run, so a piiRecord's id is there; a non-string one can't be logged.
    if (record === undefined || typeof record.id !== 'string') throw new TypeError('an unmasked pii() value has no record id to log');
    looks.set(`${record.table}\u0000${record.id}`, { table: record.table, id: record.id });
    return value;
  }
  if ('each' in plan) return Array.isArray(value) ? value.map((v) => walk(plan.each, v, may, record, looks)) : value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  // The nearest record holds the look, and its own key: a customer reached through an order is a look at the
  // customer, shown with the customer's key, if any, never the order's.
  const here: Record_ = plan.table === undefined ? record
    : { table: plan.table, id: object['id'], ...(plan.seenWith === undefined ? {} : { seenWith: plan.seenWith }) };
  const out = { ...object };
  for (const [k, p] of Object.entries(plan.fields)) if (k in out) out[k] = walk(p, out[k], may, here, looks);
  return out;
}

/** The output as this request may be shown it (`ctx.shows`), and the distinct records it showed a value of unmasked
 * (ADR-005 §7c). */
export function maskOutput(plan: PiiPlan, value: unknown, sight: Sight): { value: unknown; looks: Look[] } {
  const looks = new Map<string, Look>();
  const shown = walk(plan, value, sight, undefined, looks);
  return { value: shown, looks: [...looks.values()] };
}

/** Where an input holds a string starting with the mask's six bullets, or null. A write refuses it, so a masked value
 * is never saved over the real one, while text pasted from a bulleted list still saves (ADR-001 §7a). */
export function maskedInputPath(value: unknown, path: (string | number)[] = []): (string | number)[] | null {
  if (typeof value === 'string') return value.startsWith(BULLETS) ? path : null;
  if (typeof value !== 'object' || value === null) return null;
  for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    const found = maskedInputPath(v, [...path, k]);
    if (found !== null) return found;
  }
  return null;
}
