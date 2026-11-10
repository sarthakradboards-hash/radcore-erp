// T1's control (ADR-001 §5): what a service may do with ctx.tx: hand it to its own module transaction, use that,
// and open a savepoint that gets a module transaction again. It must compile.
import type { Ctx } from '@radcore/lib-platform';
import { salesTx } from '@radcore/db/sales';

export const f = async (ctx: Ctx) => {
  const tx = salesTx(ctx);
  await tx.transaction(async (savepoint) => savepoint.select);
  return [tx.select, tx.query, ctx.tx, ctx.principal, ctx.requestId] as const;
};
