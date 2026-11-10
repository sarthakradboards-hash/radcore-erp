// The one transaction opener the apps use (ADR-002 §4): the generic route handler and the job runner call it, and
// nothing else can, because only the runtime entry exports it (L7).
import { platformTx, settings as settingsTable } from '@radcore/db/platform';
import { openTransaction, type Database, type TxSpec } from '@radcore/db/schema';
import { principalId, type Ctx, type Principal } from '../ctx.ts';
import { Settings } from '../settings.ts';

/**
 * Runs `fn` with a Ctx in one transaction of the contract's kind, as `principal`. The settings are read once, first,
 * in the same transaction, so the whole request sees one version of them (RAD-48).
 */
export function runInTransaction<R>(db: Database, spec: TxSpec, principal: Principal, requestId: string,
  fn: (ctx: Ctx) => Promise<R>): Promise<R> {
  return openTransaction(db, spec, { principal: principalId(principal), requestId }, async (tx) => {
    const rows = await platformTx({ tx }).select({ key: settingsTable.key, value: settingsTable.value }).from(settingsTable);
    return fn(Object.freeze({ tx, principal, requestId, settings: new Settings(rows) }));
  });
}
