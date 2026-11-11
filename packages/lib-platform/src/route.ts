// defineRoute(contract, service): a route is its contract and the service that answers it (ADR-001 §6). The compiler
// checks that the service takes the contract's input and returns its output. Route files hold only these calls, and
// take defineRoute from here (E1).
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
