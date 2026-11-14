// E7 fixture (RAD-85): a module service reads a scoped table without applying the record scope. It must fail ESLint.
import * as crm from '../../../db/src/e7/tables.ts';
type Tx = { select(): { from(t: unknown): Promise<unknown[]> } };

export const listLeads = (tx: Tx) => tx.select().from(crm.leads);
