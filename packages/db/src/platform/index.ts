// The platform module's entry (ADR-001 §5): only lib-platform imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export { auditLog, eventLog } from './logs.ts';
export { after, onIndiaDays } from '../lists.ts';

/** platform's module transaction: `platformTx(ctx)` reads, and writes only, platform's own tables (ADR-002 §4). */
export const platformTx = moduleTx({ ...tables });
