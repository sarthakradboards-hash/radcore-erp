import { salesTx } from '../../../db/src/sales/index.ts';
export async function txOf(ctx: unknown) {
  return salesTx(ctx);
}
