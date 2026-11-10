// The hr module's entry (ADR-001 §5): only lib-hr imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** hr's module transaction: `hrTx(ctx)` reads, and writes only, hr's own tables (ADR-002 §4). It has none yet. */
export const hrTx = moduleTx({});
