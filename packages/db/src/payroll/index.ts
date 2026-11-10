// The payroll module's entry (ADR-001 §5): only lib-payroll imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** payroll's module transaction: `payrollTx(ctx)` reads, and writes only, payroll's own tables (ADR-002 §4). It has none yet. */
export const payrollTx = moduleTx({});
