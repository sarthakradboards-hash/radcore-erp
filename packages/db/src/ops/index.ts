// The ops module's entry (ADR-001 §5): only lib-ops imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** ops's module transaction: `opsTx(ctx)` reads, and writes only, ops's own tables (ADR-002 §4). It has none yet. */
export const opsTx = moduleTx({});
