// E7's control (RAD-85): each read of the scoped table applies the record scope in its own function.
import { listScope, type Ctx } from '@radcore/lib-platform';
import { leads } from '../../../db/src/e7/tables.ts';
type Tx = { select(): { from(t: typeof leads): { where(c: unknown): Promise<{ createdBy: string | null }[]> } } };

export async function getLead(ctx: Ctx, tx: Tx) {
  const [lead] = await tx.select().from(leads).where(undefined);
  ctx.see('leads:read', { owner: lead?.createdBy ?? '' });
  return lead;
}
export async function mayEdit(ctx: Ctx, tx: Tx) {
  const rows = await tx.select().from(leads).where(undefined);
  return rows.filter((r) => ctx.can('leads:write', { owner: r.createdBy ?? '' }));
}
export const listLeads = (ctx: Ctx, tx: Tx) => tx.select().from(leads).where(listScope(ctx, 'leads:read', leads.createdBy));
