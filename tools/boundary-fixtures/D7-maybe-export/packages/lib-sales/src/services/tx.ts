import type { SalesTx } from '../../../db/src/sales/index.ts';
type Maybe<T> = T | null | undefined;
export const last: { tx: Maybe<SalesTx> } = { tx: null };
