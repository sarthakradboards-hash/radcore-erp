// The crm module's entry (ADR-001 §5): only lib-crm imports it (D7).
import { moduleTx } from '../module-tx.ts';
import * as tables from './tables.ts';

export { notInNonEmpty } from '../conditions.ts';
export * from './tables.ts';
export { after, searchWords } from '../lists.ts';

/** crm's module transaction: `crmTx(ctx)` reads, and writes only, crm's own tables (ADR-002 §4). */
export const crmTx = moduleTx({ ...tables });
