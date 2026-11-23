// The stock module's entry (ADR-001 §5): only lib-stock imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';
import * as jobWorkTables from './tables-job-work.ts';
import * as movesTables from './tables-moves.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export * from './tables-job-work.ts';
export * from './tables-moves.ts';
export { after, searchWords } from '../lists.ts';

/** stock's module transaction: `stockTx(ctx)` reads, and writes only, stock's own tables (ADR-002 §4). */
export const stockTx = moduleTx({ ...tables, ...movesTables, ...jobWorkTables });
