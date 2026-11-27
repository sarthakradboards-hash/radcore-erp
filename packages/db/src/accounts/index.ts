// The accounts module's entry (ADR-001 §5): only lib-accounts imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as expenseTables from './tables-expenses.ts';
import * as transferTables from './tables-transfers.ts';
import * as closeTables from './tables-close.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export * from './tables-expenses.ts';
export * from './tables-transfers.ts';
export * from './tables-close.ts';
export { after, searchWords } from '../lists.ts';
export { setPeriodLock } from '../locks.ts';

/** accounts's module transaction: `accountsTx(ctx)` reads, and writes only, accounts's own tables (ADR-002 §4). */
export const accountsTx = moduleTx({ ...tables, ...closeTables, ...expenseTables, ...transferTables });
