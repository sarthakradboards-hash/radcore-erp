// E7 fixture (RAD-85): the check is in another function than the read, so it doesn't count. It must fail ESLint.
import { leads } from '../../../db/src/e7/tables.ts';
type Ctx = { see(perm: string, r: { owner: string }): void };
type Tx = { select(): { from(t: typeof leads): Promise<unknown[]> } };

export const checkLead = (ctx: Ctx, owner: string) => ctx.see('leads:read', { owner });
export const listLeads = (tx: Tx) => tx.select().from(leads);
