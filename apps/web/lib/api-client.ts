// The typed web client (M1-04, ADR-001 §7). One client per module, built from that module's contracts:
//   export const salesApi = createClient(salesContracts);   then   await salesApi.createOrder(input, { idempotencyKey })
// Types come from the contracts at compile time, so there is nothing to regenerate. The input is checked with the
// contract's own schema before anything is sent, so the form and the API refuse the same things (RC-186).
import {
  checkInput, errorEnvelope, requestFor, type Contract, type ErrorEnvelope, type PlatformErrorCode,
} from '@radcore/lib-common';
import type { z } from 'zod';

/** A refused request: the error envelope, with the codes this contract may answer with (ADR-001 §7a). */
export class ApiError<C extends string = string> extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope<C | PlatformErrorCode>;
  constructor(status: number, envelope: ErrorEnvelope<C | PlatformErrorCode>) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
  }
  get code(): C | PlatformErrorCode {
    return this.envelope.code;
  }
}

/** A write sends the key the form made once for this submit, and keeps it across retries (ADR-001 §7a, A-0). */
export type WriteOptions = { idempotencyKey: string };
type Call<C extends Contract> = C['tx']['readOnly'] extends true
  ? (input: z.input<C['input']>) => Promise<z.output<C['output']>>
  : (input: z.input<C['input']>, options: WriteOptions) => Promise<z.output<C['output']>>;
export type Client<T extends Record<string, Contract>> = { readonly [K in keyof T]: Call<T[K]> };

export type ClientOptions = {
  /** Where the API is mounted on this origin (Caddy serves it at /api, ADR-004). */
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(c: Contract, input: unknown, options: WriteOptions | undefined, base: string, send: typeof fetch) {
  const checked = checkInput(c, input);
  if (!checked.ok) throw new ApiError(400, { ...checked.error, requestId: '' });
  const headers: Record<string, string> = { accept: 'application/json' };
  if (!c.tx.readOnly) {
    // Fail closed, as the server does (RC-132): no key, no write.
    if (!options || !UUID.test(options.idempotencyKey)) {
      throw new ApiError(400, { code: 'idempotency_key_required', message: 'This save needs its retry key', issues: [], requestId: '' });
    }
    headers['idempotency-key'] = options.idempotencyKey;
  }
  const req = requestFor(c, checked.value);
  if (req.body !== undefined) headers['content-type'] = 'application/json';
  const res = await send(`${base}${req.path}`, { method: req.method, headers, body: req.body ?? null, credentials: 'same-origin' });
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) return body;
  const env = errorEnvelope.safeParse(body);
  throw new ApiError(res.status, env.success ? env.data
    : { code: 'server_error', message: 'Something went wrong. Please try again.', issues: [], requestId: '' });
}

/** A typed function per contract. */
export function createClient<const T extends Record<string, Contract>>(contracts: T, options: ClientOptions = {}): Client<T> {
  const base = options.baseUrl ?? '/api';
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const fns = Object.fromEntries(Object.entries(contracts).map(([name, c]) =>
    [name, (input: unknown, opts?: WriteOptions) => call(c, input, opts, base, send)]));
  return fns as Client<T>; // each entry is call() bound to its own contract; the mapped type names their shapes
}
