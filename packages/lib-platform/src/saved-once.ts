// Saved-once (ADR-001 §6, §7a; RAD-27, RC-132): a write sent twice with the same Idempotency-Key runs once. The key
// is claimed inside the write's own transaction, before the service runs, by inserting (principal, route, key, input
// hash) under the table's primary key:
// - a second request with the same key waits on that key until the first ends (bounded by the lock timeout);
// - if the first committed, the second replays its stored answer; if it rolled back, the claim is gone and the second
//   runs;
// - the same key with another body is refused, and the key is scoped to the principal and the route, so one person's
//   key can't replay another's answer;
// - the answer is stored in the same transaction as the work, so a crash after commit can't lose it.
// Every signed-out caller of a public route runs as one principal, `system:public`, so their keys share one scope:
// a public route's answer must hold nothing personal, since anyone who learned the key could replay it.
import { createHash } from 'node:crypto';
import { platformTx, savedOnce } from '@radcore/db/platform';
import { and, eq } from 'drizzle-orm';
import { principalId, type Ctx } from './ctx.ts';
import { AppError } from './errors.ts';

const HOUR_MS = 3_600_000;
/** How long a claimed key is kept before the clean-up job deletes it: a screen retries within minutes, while an
 * offline client syncs days later (RAD-27). */
export const SAVED_ONCE_KEEP_MS = { screen: 48 * HOUR_MS, sync: 30 * 24 * HOUR_MS } as const;
export type SavedOnceClass = keyof typeof SAVED_ONCE_KEEP_MS;

export type SavedOnceClaim = {
  /** The write's route, as `METHOD /path` (the contract's own path, never the request's). */
  route: string;
  /** The Idempotency-Key header: a UUID the client makes once per submit. */
  key: string;
  /** The checked input. Its hash binds the key to this body. */
  input: unknown;
  class?: SavedOnceClass;
  /** false for a route whose answer holds a secret (RAD-32): the key is claimed, the answer never stored. */
  storesAnswer?: boolean;
};

/** Either the earlier answer to replay, or a fresh claim, whose answer `keep` stores before commit. */
export type SavedOnce =
  | { readonly replay: true; readonly answer: unknown }
  | { readonly replay: false; keep(answer: unknown): Promise<void> };

const hashOf = (input: unknown): string => createHash('sha256').update(JSON.stringify(input) ?? '').digest('hex');

/** Claims `key` for this request, in `ctx`'s transaction. Call it first, before the service writes anything. */
export async function claimSavedOnce(ctx: Ctx, claim: SavedOnceClaim): Promise<SavedOnce> {
  const tx = platformTx(ctx);
  const principal = principalId(ctx.principal);
  const inputHash = hashOf(claim.input);
  const expiresAt = new Date(Date.now() + SAVED_ONCE_KEEP_MS[claim.class ?? 'screen']);
  const thisKey = and(eq(savedOnce.principal, principal), eq(savedOnce.route, claim.route), eq(savedOnce.key, claim.key));

  // Waits here while another transaction holds the same key, then inserts (it rolled back) or skips (it committed).
  const [fresh] = await tx.insert(savedOnce).values({ principal, route: claim.route, key: claim.key, inputHash, expiresAt })
    .onConflictDoNothing().returning({ key: savedOnce.key });
  if (fresh !== undefined) {
    return {
      replay: false,
      keep: async (answer) => {
        if (claim.storesAnswer === false) return;
        await tx.update(savedOnce).set({ answer, kept: true }).where(thisKey);
      },
    };
  }

  const [earlier] = await tx.select({ inputHash: savedOnce.inputHash, answer: savedOnce.answer, kept: savedOnce.kept })
    .from(savedOnce).where(thisKey);
  // Deleted between the two statements by the clean-up job: rare, and a retry with the same key then simply runs.
  if (earlier === undefined) throw new AppError('conflict', 'This request crossed another one. Please try again');
  if (earlier.inputHash !== inputHash) {
    throw new AppError('idempotency_mismatch', 'This idempotency key was used for a different request');
  }
  if (!earlier.kept) {
    throw new AppError('answer_not_kept', 'This was already done, and its answer is not kept. Please start again');
  }
  return { replay: true, answer: earlier.answer };
}
