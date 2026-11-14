// E7 fixture (RAD-85): a module service reads a scoped table without applying the record scope. It must fail ESLint.
import { leads as l } from '../../../db/src/e7/tables.ts';
type Tx = { select(): { from(t: unknown): { innerJoin(t: unknown): Promise<unknown[]> } } };

export const listLeads = (tx: Tx, other: unknown) => tx.select().from(other).innerJoin(l);
