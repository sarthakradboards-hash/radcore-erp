import { salesTx } from '../../../db/src/sales/index.ts';
export const tx = (ctx: unknown) => salesTx(ctx);
