// What every service gets (ADR-001 §5, §6a, RAD-26): the request's opaque transaction, who it runs as, its id, and
// the settings.
// `ctx.tx` has no members, so a service can only hand it to its own module transaction (`salesTx(ctx)`) (T1).
import type { Tx } from '@radcore/db/schema';
import type { JobContract } from './jobs.ts';
import type { Settings } from './settings.ts';

/** Who a request or job runs as (ADR-001 §6a). Link principals arrive with M1-23. */
export type Principal =
  | { readonly kind: 'user'; readonly userId: string; readonly permissions: readonly string[] }
  | { readonly kind: 'system'; readonly name: string; readonly permissions: readonly string[] };

/** Queues jobs in the caller's transaction, through the outbox (ADR-002 §4): a save that rolls back queues nothing. */
export type Jobs = {
  /** Checks input against the job's own schema now, so a bad payload fails the save, not the job later. */
  send<I>(job: JobContract<I>, input: I): Promise<void>;
};

export type Ctx = {
  readonly tx: Tx;
  readonly principal: Principal;
  /** Logged with every line about this request, and recorded on audit rows. */
  readonly requestId: string;
  /** Every setting, read once when this Ctx was built (RAD-48): `ctx.settings.get(def)`. */
  readonly settings: Settings;
  /** `ctx.jobs.send(contract, input)`: the job runs after this transaction commits, never if it rolls back. */
  readonly jobs: Jobs;
};

/** How audit rows and `app.principal` name a principal: `user:<id>` or `system:<name>`. */
export const principalId = (p: Principal): string => (p.kind === 'user' ? `user:${p.userId}` : `system:${p.name}`);
