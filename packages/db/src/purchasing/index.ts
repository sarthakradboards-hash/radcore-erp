// The purchasing module's entry (ADR-001 §5): only lib-purchasing imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** purchasing's module transaction: `purchasingTx(ctx)` reads, and writes only, purchasing's own tables (ADR-002 §4). It has none yet. */
export const purchasingTx = moduleTx({});
