// The architect's counterexample on #231 (RAD-89): walking Svc meets Helper while Svc is still being walked, so Helper
// looks clean; box reaches the transaction only through Helper, and must still be reported.
import type { SalesTx } from '../../db/src/sales/index.ts';
interface Helper { back(): Svc }
export interface Svc { helper: Helper; run(tx: SalesTx): void }
export declare const box: { h: Helper };
