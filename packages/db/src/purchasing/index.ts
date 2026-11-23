// The purchasing module's entry (ADR-001 §5): only lib-purchasing imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as orderTables from './tables-orders.ts';
import * as receiptTables from './tables-receipts.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables-orders.ts';
export * from './tables-receipts.ts';
export { after, searchWords } from '../lists.ts';

/** purchasing's module transaction: `purchasingTx(ctx)` reads, and writes only, purchasing's own tables (ADR-002 §4). */
export const purchasingTx = moduleTx({ ...orderTables, ...receiptTables });
