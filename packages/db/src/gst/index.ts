// The gst module's entry (ADR-001 §5): only lib-gst imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export { after } from '../lists.ts';

/** gst's module transaction: `gstTx(ctx)` reads, and writes only, gst's own tables (ADR-002 §4). */
export const gstTx = moduleTx({ ...tables });
