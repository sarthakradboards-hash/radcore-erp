// E7 fixture (RAD-85): a module service reads a scoped table without applying the record scope. It must fail ESLint.
import { leads } from '../../../db/src/e7/tables.ts';
type Tx = { select(): { from(t: typeof leads): Promise<unknown[]> } };

export const listLeads = (tx: Tx) => tx.select().from(leads);
