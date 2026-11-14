// Route contracts (M1-04, ADR-001 §6, §7, §7a). A route is declared once, as data: method, path, who may call it,
// its transaction, input and output schemas, and the error codes it may answer with. The API's generic handler
// (M1-08), the web client (apps/web/lib/api-client.ts) and the permission manifest (M1-19) all read the same object.
// The wire rules live here too, so the handler and the client can't encode a request two ways: requestFor builds
// it, readInput reads it back and checks it.
import { z } from 'zod';
import { dateString } from './dates.ts';

/** ADR-001 §7a: the platform's error codes and their HTTP status. A contract adds its own, answered as 422. */
export const PLATFORM_ERRORS = {
  invalid_input: 400, idempotency_key_required: 400, signed_out: 401, forbidden: 403, not_found: 404,
  conflict: 409, idempotency_mismatch: 409, answer_not_kept: 409, rate_limited: 429, account_locked: 429, server_error: 500,
} as const;
export type PlatformErrorCode = keyof typeof PLATFORM_ERRORS;
export const BUSINESS_RULE_STATUS = 422;

const issue = z.object({ path: z.array(z.union([z.string(), z.number()])), code: z.string(), message: z.string() });
/** The codes that say how long to wait before a retry (RAD-61); the response's Retry-After header holds the same. */
export const RETRY_AFTER_CODES: readonly string[] = ['rate_limited', 'account_locked'];
/** Every failure has this shape (ADR-001 §7a). `issues` is empty when the failure isn't about one field.
 * `retryAfterSeconds` is whole seconds, rounded up, and only on the RETRY_AFTER_CODES. */
export const errorEnvelope = z.object({
  code: z.string(), message: z.string(), issues: z.array(issue), requestId: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
}).refine((e) => e.retryAfterSeconds === undefined || RETRY_AFTER_CODES.includes(e.code),
  { message: 'Only rate_limited and account_locked say when to retry', path: ['retryAfterSeconds'] });
export type Issue = z.infer<typeof issue>;
export type ErrorEnvelope<C extends string = string> = Omit<z.infer<typeof errorEnvelope>, 'code'> & { code: C };

/** The most rows one page may ask for (ADR-002 §4, RC-176). */
export const MAX_LIMIT = 200;
/** The most characters a cursor may hold; encodeCursor refuses a sort key that would go past it. */
export const MAX_CURSOR_LENGTH = 512;
/** An opaque paging cursor: base64url of the sort key. Clients only send back what they were given (M1-29). */
export const cursorString = () =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${String(MAX_CURSOR_LENGTH)}}$`), 'Not a page cursor');
/**
 * A list's sort, as ui-2's DataTable (RAD-54) reports it: `{ column, desc }`. `column` is one of the contract's
 * sortable columns, so any other is invalid_input on ['sort', 'column']. The repo maps it to a database column through
 * a fixed object (`{ name: parties.name }`), so the client's text never reaches SQL or a column lookup.
 */
export const sortInput = <const C extends readonly [string, ...string[]]>(columns: C) =>
  z.strictObject({ column: z.enum(columns), desc: z.boolean() });
const listBase = { after: cursorString().optional(), limit: z.number().int().min(1).max(MAX_LIMIT) };
/**
 * A list's input: `{ filter, sort?, after?, limit }`, with `next` from the previous page sent back as `after`. `sort`
 * is a sibling of `filter`, optional: left out, the contract's own default order applies. A list declared without
 * sortable columns refuses any `sort` sent to it.
 */
export const listInput = <F extends z.ZodType, S extends z.ZodType = z.ZodNever>(filter: F, sort?: S) =>
  z.object({ filter, sort: (sort ?? z.never()).optional(), ...listBase });
// Passwords (ADR-001 §7a, M1-14). The schemas set only the cap: the minimum length, the bundled list and Pwned
// Passwords are the new-password check's, which the generic handler runs before the transaction on a field
// marked newPassword(), and a refusal is password_rejected (too_short, breached or same_as_old).
/** A new password's minimum, counted as Unicode code points after NFC normalisation (see passwordLength). */
export const PASSWORD_MIN_LENGTH = 15;
/** Every password field's cap, sign-in included, in the UTF-16 units zod counts: a password that could be set can
 * always be typed at sign-in. */
export const PASSWORD_MAX_LENGTH = 1024;
/** A password's length as the rule counts it: code points of its NFC form, which is also what gets hashed. */
export const passwordLength = (password: string): number => [...password.normalize('NFC')].length;
/** The fields the new-password check runs on. */
export const newPasswordFields = z.registry<{ check: 'new_password' }>();
/** A password a person is setting: invite accept, reset and change. Only those three routes may use it (M1-19). */
export const newPassword = () => z.string().max(PASSWORD_MAX_LENGTH).register(newPasswordFields, { check: 'new_password' });
/** The fields the handler keeps as a change's reason (RAD-36, ADR-005 §7c): its audit rows point at the reason. */
export const reasonFields = z.registry<{ keep: 'change_reason' }>();
/** Why a change that removes access or power was made, in the admin's own words. The handler stores it once, and each
 * audit row of the change carries its id, never its text. */
export const reason = () => z.string().trim().min(1, 'Say why, in your own words').max(500)
  .register(reasonFields, { keep: 'change_reason' });
/** A password typed to prove who you are: sign-in, and the current password on a change. No rule but the cap. */
export const passwordString = () => z.string().min(1).max(PASSWORD_MAX_LENGTH);
/** A search box's text, sent as `filter.search` (RAD-52's useApiSearch). The server splits it into words. */
export const searchText = () => z.string().max(100, 'Search for at most 100 characters');
/** A date filter, `filter.from` to `filter.to`, both included and either one optional (M1-29). */
export const dateRange = () => z.object({ from: dateString().optional(), to: dateString().optional() })
  .refine((r) => r.from === undefined || r.to === undefined || r.from <= r.to,
    { error: 'The start date is after the end date', path: ['to'] });
/** A list's output: `{ items, next }`, `next` null on the last page. There is no total count (RC-176). */
export const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), next: z.string().nullable() });

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** A permission key, "module:action". M1-17 lists them and says which roles hold them. */
export type PermissionKey = `${string}:${string}`;
type ReadTx = { readOnly: true; isolation: 'read committed' | 'repeatable read'; statementTimeoutMs?: number };
type WriteTx = { readOnly: false; isolation: 'read committed'; statementTimeoutMs?: number };
/** Who may call it (ADR-001 §6a). A public route names its rate-limit class (M1-21). */
type Access =
  | { auth: 'session'; perm: PermissionKey }
  | { auth: 'public'; rateLimit: string; perm: PermissionKey | null }
  | { auth: 'webhook'; perm: null };

/** `'exempt'` only on a route whose answer sets or clears the session cookie (ADR-001 §7a). */
export type Idempotency = 'exempt' | undefined;

export type ContractSpec<M extends Method, I extends z.ZodType, O extends z.ZodType, E extends string,
  X extends Idempotency = undefined> = Access & {
  method: M;
  /** Lower-case segments and `:name` parameters, each a key of the input: "/sales/invoices/:id". */
  path: string;
  /** A GET can't write (ADR-002 §4), so a cross-site GET can't either. */
  tx: M extends 'GET' ? ReadTx : ReadTx | WriteTx;
  input: I;
  output: O;
  /** The business-rule codes this route may answer with (422), beyond the platform's. */
  errors?: readonly E[];
  /** A write that needs no Idempotency-Key, because a stored answer can't set a cookie. Only the routes on
   * lib-platform's fixed list may declare it (ADR-001 §7a); the web client then sends no key. */
  idempotency?: X;
  /** A write whose answer holds a secret: saved-once claims the key but stores no answer, and a repeat gets 409
   * `answer_not_kept` (ADR-001 §7a, RAD-32). Only the routes on lib-platform's fixed list may declare it. */
  storesAnswer?: false;
};
export type Contract<M extends Method = Method, I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType,
  E extends string = string, X extends Idempotency = Idempotency> =
  Readonly<ContractSpec<M, I, O, E, X> & { errors: readonly E[]; params: readonly string[] }>;

const PATH = /^(\/([a-z0-9]+(-[a-z0-9]+)*|:[a-z][A-Za-z0-9]*))+$/;
const CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

// shortcut: input and output JSON Schemas must match and be representable, which refuses .transform(), a pipe to
// another type, .default(), z.date() and z.bigint(); z.coerce and .trim() pass, so review still watches for them.
// zod marks an output object additionalProperties: false (it drops unknown keys), so that key is left out of the match.
const json = (s: unknown) => JSON.stringify(s, (k, v: unknown) => (k === 'additionalProperties' ? undefined : v));
function wireExact(name: string, schema: z.ZodType): void {
  let input: string, output: string;
  try {
    input = json(z.toJSONSchema(schema, { io: 'input' }));
    output = json(z.toJSONSchema(schema, { io: 'output' }));
  } catch (e) {
    throw new TypeError(`${name} isn't plain JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (input !== output) throw new TypeError(`${name} changes the value it reads (a transform, pipe or default)`);
}

/** Declares a route. Throws at load time on a contract that breaks a wire or transaction rule. */
export function defineContract<const M extends Method, I extends z.ZodType, O extends z.ZodType,
  const E extends string = never, const X extends Idempotency = undefined>(spec: ContractSpec<M, I, O, E, X>):
  Contract<M, I, O, E, X> {
  const at = `${spec.method} ${spec.path}`;
  if (!PATH.test(spec.path)) throw new TypeError(`${at}: the path must be lower-case segments and :params`);
  const params = spec.path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1));
  const keys = spec.input instanceof z.ZodObject ? Object.keys(spec.input.shape) : [];
  for (const p of params) if (!keys.includes(p)) throw new TypeError(`${at}: :${p} isn't a field of the input`);
  // The types already say this; these also hold for a contract built without them.
  if (spec.method === 'GET' && !spec.tx.readOnly) throw new TypeError(`${at}: a GET must be read-only`);
  if (!spec.tx.readOnly && spec.tx.isolation !== 'read committed') throw new TypeError(`${at}: a write is read committed`);
  // Both concern saved-once, which only a write has; an exempt route stores nothing, so the two never go together.
  if (spec.tx.readOnly && (spec.idempotency !== undefined || spec.storesAnswer !== undefined)) {
    throw new TypeError(`${at}: only a write declares idempotency or storesAnswer`);
  }
  if (spec.idempotency !== undefined && spec.storesAnswer !== undefined) {
    throw new TypeError(`${at}: an exempt route stores no answer, so it doesn't declare storesAnswer`);
  }
  const ms = spec.tx.statementTimeoutMs;
  // 0 would switch the timeout off (RC-080); the configured maximum is checked by the handler (M1-08).
  if (ms !== undefined && !(Number.isInteger(ms) && ms > 0)) throw new TypeError(`${at}: statementTimeoutMs must be a positive integer`);
  const errors = spec.errors ?? [];
  for (const c of errors) {
    if (!CODE.test(c) || Object.hasOwn(PLATFORM_ERRORS, c)) throw new TypeError(`${at}: "${c}" can't be a contract's error code`);
  }
  if (new Set(errors).size !== errors.length) throw new TypeError(`${at}: an error code is listed twice`);
  wireExact(`${at} input`, spec.input);
  wireExact(`${at} output`, spec.output);
  return Object.freeze({ ...spec, errors, params });
}

type Sent = { method: Method; path: string; body: string | undefined };

/** The request for a contract and an input: path parameters in the path; the rest as JSON, in the body for a write
 * method and in `?input=` for GET and DELETE. */
export function requestFor(c: Contract, input: unknown): Sent {
  const rest: Record<string, unknown> = input !== null && typeof input === 'object' ? { ...input } : {};
  let path = c.path;
  for (const p of c.params) {
    const v = rest[p];
    if (typeof v !== 'string' || v === '') throw new TypeError(`${c.method} ${c.path}: :${p} needs a value`);
    path = path.replace(`:${p}`, encodeURIComponent(v));
    delete rest[p];
  }
  const payload = c.params.length > 0 || input === undefined ? rest : input;
  const json = JSON.stringify(payload);
  if (c.method === 'GET' || c.method === 'DELETE') {
    return { method: c.method, path: json === '{}' ? path : `${path}?input=${encodeURIComponent(json)}`, body: undefined };
  }
  return { method: c.method, path, body: json };
}

export type InputResult<T> = { ok: true; value: T } | { ok: false; error: Omit<ErrorEnvelope<'invalid_input'>, 'requestId'> };

const invalid = (issues: Issue[]): InputResult<never> =>
  ({ ok: false, error: { code: 'invalid_input', message: 'Some of what was sent needs correcting', issues } });

/** Checks an input against its contract, with each problem as an issue a form can show beside its field. */
export function checkInput<I extends z.ZodType>(c: { readonly input: I }, raw: unknown): InputResult<z.output<I>> {
  const r = z.safeParse(c.input, raw);
  if (r.success) return { ok: true, value: r.data };
  return invalid(r.error.issues.map((i) => ({
    path: i.path.map((k) => (typeof k === 'number' ? k : String(k))), code: i.code, message: i.message,
  })));
}

/** The handler's side of requestFor: the path parameters, `?input=` or the body, read back and checked. */
export function readInput<I extends z.ZodType>(c: Pick<Contract, 'method' | 'params'> & { readonly input: I }, sent: {
  params: Readonly<Record<string, string>>; query?: string | undefined; body?: unknown }): InputResult<z.output<I>> {
  const inUrl = c.method === 'GET' || c.method === 'DELETE';
  // One encoding per method: a write's input is its body only, so it never lands in an access log or a browser's
  // history, and what is checked is what the service gets.
  if (!inUrl && sent.query !== undefined) {
    return invalid([{ path: [], code: 'input_in_url', message: `A ${c.method} sends its input in the body, not the URL` }]);
  }
  let raw: unknown = inUrl ? undefined : sent.body;
  if (sent.query !== undefined) {
    try {
      raw = JSON.parse(sent.query);
    } catch {
      return invalid([{ path: [], code: 'invalid_json', message: 'The request is not valid JSON' }]);
    }
  }
  if (c.params.length > 0) {
    const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    raw = { ...base, ...Object.fromEntries(c.params.map((p) => [p, sent.params[p]])) };
  }
  return checkInput(c, raw ?? {});
}
