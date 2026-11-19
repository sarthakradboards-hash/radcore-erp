export class PgTable {
  readonly name = 'invoices';
}
export const invoices = new PgTable();
export type SalesTx = { readonly module: 'sales' };
export const salesTx = (ctx: unknown): SalesTx => ({ module: 'sales', ...(ctx as object) });
