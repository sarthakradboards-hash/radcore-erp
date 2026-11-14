// E7 fixture (RAD-85): a module service reads a scoped table without applying the record scope. It must fail ESLint.
type Tx = { query: { leads: { findMany(): Promise<unknown[]> } } };

export const listLeads = (tx: Tx) => tx.query.leads.findMany();
