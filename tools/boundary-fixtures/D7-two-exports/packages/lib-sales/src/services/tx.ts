// Two exports reaching one transaction type: the walk's shared memory must not hide the second (RAD-89).
import { salesTx } from '../../../db/src/sales/index.ts';
export const tx = (ctx: unknown) => salesTx(ctx);
export const again = (ctx: unknown) => salesTx(ctx);
