// The hr module's entry (ADR-001 §5): only lib-hr imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export { after, searchWords } from '../lists.ts';

/** hr's module transaction: `hrTx(ctx)` reads, and writes only, hr's own tables (ADR-002 §4). */
export const hrTx = moduleTx({ ...tables });
