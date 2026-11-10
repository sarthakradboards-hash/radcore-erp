// The accounts module's entry (ADR-001 §5): only lib-accounts imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** accounts's module transaction: `accountsTx(ctx)` reads, and writes only, accounts's own tables (ADR-002 §4). It has none yet. */
export const accountsTx = moduleTx({});
