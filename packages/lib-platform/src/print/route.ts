// A printout's route (RAD-120): its `before` step reads the document at the printer's scope, in a short read of its
// own, then renders it on the print pool, holding no transaction while it waits (ADR-001 §8). The service answers the
// bytes; the handler sends them as application/pdf and logs the look at the document (the contract's `print`).
import type { printContract } from '../contract/print.ts';
import { defineRoute, type Route } from '../route.ts';
import type { PrintDef } from './blocks.ts';
import { renderPdf } from './pool.ts';

export function definePrintRoute<M>(contract: ReturnType<typeof printContract<string>>, def: PrintDef<M>): Route {
  return defineRoute(contract, async (_ctx, _input, { before }: { before: Uint8Array }) => before, {
    before: async ({ id, paper }, { read }) => {
      const model = await read((ctx) => def.read(ctx, id));
      return renderPdf(def.layout(model, paper), paper, def.title(model));
    },
  });
}
