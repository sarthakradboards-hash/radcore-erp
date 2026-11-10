// The one transaction opener the apps use (ADR-002 §4): the generic route handler and the job runner call it, and
// nothing else can, because only the runtime entry exports it (L7).
import { openTransaction, type Database, type TxSpec } from '@radcore/db/schema';
import { principalId, type Ctx, type Principal } from '../ctx.ts';

/** Runs `fn` with a Ctx in one transaction of the contract's kind, as `principal`. */
export function runInTransaction<R>(db: Database, spec: TxSpec, principal: Principal, requestId: string,
  fn: (ctx: Ctx) => Promise<R>): Promise<R> {
  return openTransaction(db, spec, { principal: principalId(principal), requestId },
    (tx) => fn(Object.freeze({ tx, principal, requestId })));
}
