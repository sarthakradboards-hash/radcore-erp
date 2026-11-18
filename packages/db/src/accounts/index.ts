// The accounts module's entry (ADR-001 §5): only lib-accounts imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';

/** accounts's module transaction: `accountsTx(ctx)` reads, and writes only, accounts's own tables (ADR-002 §4). */
export const accountsTx = moduleTx({ ...tables });
