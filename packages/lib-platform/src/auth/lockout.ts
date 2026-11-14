// Sign-in lockout (M1-14, RC-089, ADR-001 §7a, RAD-64 item 4): sign-in attempts are counted per email address typed,
// whether or not an account has it, in the shared store. Each attempt is counted, atomically, before the password is
// checked, so parallel attempts can't all slip past a check made before any of them was counted. A success clears
// the count. A lock is short and ends on its own; a password reset clears it; an admin can lift it. The store keeps
// the address's HMAC under RATE_LIMIT_KEY (RAD-73), never the address.
import { normaliseEmail } from '@radcore/lib-common';
import type { Limiter } from '../db/client.ts';

/** M1-14's numbers: 10 attempts per address within 15 minutes; the 11th is refused and locks it for 15 minutes. */
export const LOCKOUT = Object.freeze({ points: 10, windowSeconds: 900, blockSeconds: 900 });

export type Lockout = {
  /** Counts this attempt. 0: go ahead and check the password; otherwise the seconds until this address may try again. */
  attempt(email: string): Promise<number>;
  /** The password was right: the address starts again from no attempts. */
  succeeded(email: string): Promise<void>;
};

// The store hashes it (RAD-73); one address, however it's typed, is one key.
const keyOf = (email: string) => `email:${normaliseEmail(email)}`;

export function createLockout(limiter: Limiter): Lockout {
  return Object.freeze({
    attempt: (email: string) => limiter.hit(keyOf(email)),
    succeeded: (email: string) => limiter.reset(keyOf(email)),
  });
}
