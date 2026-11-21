// The sales module's entry (ADR-001 §5): only lib-sales imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as creditTables from './tables-credit.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export * from './tables-credit.ts';
export { after, searchWords } from '../lists.ts';

/** sales's module transaction: `salesTx(ctx)` reads, and writes only, sales's own tables (ADR-002 §4). */
export const salesTx = moduleTx({ ...tables, ...creditTables });
