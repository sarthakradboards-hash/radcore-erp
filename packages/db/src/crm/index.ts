// The crm module's entry (ADR-001 §5): only lib-crm imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** crm's module transaction: `crmTx(ctx)` reads, and writes only, crm's own tables (ADR-002 §4). It has none yet. */
export const crmTx = moduleTx({});
