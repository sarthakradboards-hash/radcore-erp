// The sales module's entry (ADR-001 §5): only lib-sales imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** sales's module transaction: `salesTx(ctx)` reads, and writes only, sales's own tables (ADR-002 §4). It has none yet. */
export const salesTx = moduleTx({});
