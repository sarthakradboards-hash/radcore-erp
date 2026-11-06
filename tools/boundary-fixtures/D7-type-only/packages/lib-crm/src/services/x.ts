import type { SalesTx } from '@radcore/db/sales';
export const f = (ctx: { tx: unknown }) => (ctx.tx as SalesTx).query.invoices;
