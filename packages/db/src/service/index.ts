// The service module's entry (ADR-001 §5): only lib-service imports it (D7).
import { moduleTx } from '../module-tx.ts';

export { notInNonEmpty } from '../conditions.ts';

/** service's module transaction: `serviceTx(ctx)` reads, and writes only, service's own tables (ADR-002 §4). It has none yet. */
export const serviceTx = moduleTx({});
