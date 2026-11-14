// defineRoute(contract, service): a route is its contract and the service that answers it (ADR-001 §6). The compiler
// checks that the service takes the contract's input and returns its output. Route files hold only these calls, and
// import it from here, as E1 asks of every define* helper (RAD-26; moved from apps/api for RAD-31, RAD-43, RAD-57).
// A route whose service needs an outside call, such as a KMS decrypt, declares a `before` step (ADR-001 §8, RAD-33):
// the handler runs it outside any transaction and hands its result to the service as `meta.before`.
import type { Contract } from '@radcore/lib-common';
import type { Ctx, Principal, SessionCookie } from './ctx.ts';
import type { Secrets } from './secrets.ts';
import type { z } from 'zod';

/** What a route's `before` step may use. Nothing here holds a transaction open while it waits. */
export type BeforeDeps = {
  /** The secrets library: each encrypt and decrypt is a KMS call in staging and production. */
  readonly secrets: Secrets;
  /** Runs `work` in a short read-only transaction of its own, closed before this resolves. */
  read<R>(work: (ctx: Ctx) => Promise<R>): Promise<R>;
  /** Who the request is for, as the service will see them. */
  readonly principal: Principal;
  /** The sign-in cookies, on the sign-in routes only, as the service will see them. */
  readonly cookie: SessionCookie | undefined;
};

export type Route = {
  readonly contract: Contract;
  readonly service: (ctx: Ctx, input: unknown, meta: { before: unknown }) => Promise<unknown>;
  readonly before?: (input: unknown, deps: BeforeDeps) => Promise<unknown>;
};

export function defineRoute<C extends Contract, B = undefined>(contract: C,
  service: (ctx: Ctx, input: z.output<C['input']>, meta: { before: B }) => Promise<z.input<C['output']>>,
  { before }: { before?: (input: z.output<C['input']>, deps: BeforeDeps) => Promise<B> } = {}): Route {
  return Object.freeze({ contract, service: service as Route['service'],
    ...(before === undefined ? {} : { before: before as NonNullable<Route['before']> }) });
}
