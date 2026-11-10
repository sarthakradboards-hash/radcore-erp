// The gst module's entry (ADR-001 §5): only lib-gst imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** gst's module transaction: `gstTx(ctx)` reads, and writes only, gst's own tables (ADR-002 §4). It has none yet. */
export const gstTx = moduleTx({});
