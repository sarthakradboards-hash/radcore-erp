import { salesTx, type SalesTx } from '../../db/src/sales/index.ts';
export const inSales = <T>(ctx: unknown, fn: (tx: SalesTx) => T): T => fn(salesTx(ctx));
