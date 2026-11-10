// What every service gets (ADR-001 §5, §6a, RAD-26): the request's opaque transaction, who it runs as, and its id.
// `ctx.tx` has no members, so a service can only hand it to its own module transaction (`salesTx(ctx)`) (T1).
import type { Tx } from '@radcore/db/schema';

/** Who a request or job runs as (ADR-001 §6a). Link principals arrive with M1-23. */
export type Principal =
  | { readonly kind: 'user'; readonly userId: string; readonly permissions: readonly string[] }
  | { readonly kind: 'system'; readonly name: string; readonly permissions: readonly string[] };

export type Ctx = {
  readonly tx: Tx;
  readonly principal: Principal;
  /** Logged with every line about this request, and recorded on audit rows. */
  readonly requestId: string;
};

/** How audit rows and `app.principal` name a principal: `user:<id>` or `system:<name>`. */
export const principalId = (p: Principal): string => (p.kind === 'user' ? `user:${p.userId}` : `system:${p.name}`);
