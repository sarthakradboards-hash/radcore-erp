import { AsyncLocalStorage } from 'node:async_hooks';
import type { SalesTx } from '../../../db/src/sales/index.ts';
export const current = new AsyncLocalStorage<SalesTx>();
