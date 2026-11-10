// The platform module's entry (ADR-001 §5): only lib-platform imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** platform's module transaction: `platformTx(ctx)` reads, and writes only, platform's own tables (ADR-002 §4). It has none yet. */
export const platformTx = moduleTx({});
