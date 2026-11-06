type OpaqueTx = { readonly opaque: 'tx' };
export type Ctx = { tx: OpaqueTx; can(perm: string): Promise<boolean> };
export async function listInvoices(ctx: Ctx, input: { limit: number }) {
  return [{ id: 'x', limit: input.limit, allowed: await ctx.can('sales:read') }];
}
export const inTransaction = <T>(ctx: Ctx, fn: (c: Ctx) => T): T => fn(ctx);
