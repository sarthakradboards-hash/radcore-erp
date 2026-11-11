// defineRoute(contract, service): a route is its contract and the service that answers it (ADR-001 §6). The compiler
// checks that the service takes the contract's input and returns its output. Route files hold only these calls, and
// import it from here, as E1 asks of every define* helper (RAD-26; moved from apps/api for RAD-31, RAD-43, RAD-57).
import type { Contract } from '@radcore/lib-common';
import type { Ctx } from './ctx.ts';
import type { z } from 'zod';

export type Route = {
  readonly contract: Contract;
  readonly service: (ctx: Ctx, input: unknown) => Promise<unknown>;
};

export function defineRoute<C extends Contract>(contract: C,
  service: (ctx: Ctx, input: z.output<C['input']>) => Promise<z.input<C['output']>>): Route {
  return Object.freeze({ contract, service: service as Route['service'] });
}
