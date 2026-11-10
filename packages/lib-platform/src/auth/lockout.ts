// Sign-in lockout (M1-14, RC-089, ADR-001 §7a, RAD-64 item 4): failed sign-ins are counted per email address typed,
// whether or not an account has it, in the shared store. A lock is short and ends on its own; a success or a
// password reset clears it; an admin can lift it. The store keeps the address's SHA-256, never the address.
import { createHash } from 'node:crypto';
import { normaliseEmail } from '@radcore/lib-common';
import type { Limiter } from '../db/client.ts';

/** M1-14's numbers: 10 failed sign-ins within 15 minutes lock that address for 15 minutes. */
export const LOCKOUT = Object.freeze({ points: 10, windowSeconds: 900, blockSeconds: 900 });

export type Lockout = {
  /** Seconds until this address may try again; 0 when it isn't locked. */
  lockedFor(email: string): Promise<number>;
  /** Counts a failed sign-in, and answers the lock it caused, if any. */
  failed(email: string): Promise<number>;
  clear(email: string): Promise<void>;
};

const keyOf = (email: string) => createHash('sha256').update(normaliseEmail(email)).digest('hex');

export function createLockout(limiter: Limiter): Lockout {
  return Object.freeze({
    lockedFor: (email: string) => limiter.wait(keyOf(email)),
    failed: (email: string) => limiter.hit(keyOf(email)),
    clear: (email: string) => limiter.reset(keyOf(email)),
  });
}
