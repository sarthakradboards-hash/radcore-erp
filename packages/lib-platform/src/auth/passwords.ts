// Password hashing (M1-14, RC-090, ADR-003): Argon2id at OWASP's minimum cost, the same in every environment. A hash
// made with other parameters is rehashed at the next sign-in. A password is never logged, stored or returned. What's
// hashed and checked is the password's NFC form (ADR-001 §7a), so its spelling in Unicode doesn't matter.
import { randomBytes } from 'node:crypto';
import { hash, parseOptions, verify, type Options, type ParsedHashOptions } from '@node-rs/argon2';

// @node-rs/argon2's Algorithm is a const enum, which isolated modules can't import; 2 is its Argon2id.
const ARGON2ID = 2 as NonNullable<Options['algorithm']>;

/** ADR-003's parameters: m = 19,456 KiB, t = 2, p = 1. There is no cheaper setting for tests or CI. */
export const PASSWORD_HASH = Object.freeze({ algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

type Verified = { ok: boolean; rehash: boolean };

export type Passwords = {
  hash(password: string): Promise<string>;
  /**
   * Checks a password against a stored hash; `null` (no account, or no password set yet) checks against the dummy,
   * so it takes as long as a wrong password (RAD-64). `rehash` asks the caller to store a new hash after a success.
   */
  verify(stored: string | null, password: string): Promise<Verified>;
  /** The dummy hash, made once per process at the current parameters, of a random password nobody knows. */
  readonly dummy: string;
};

// The four parameters as one string, so a stored hash's can be compared with the current ones in one step.
const params = (o: Pick<ParsedHashOptions, 'algorithm' | 'memoryCost' | 'timeCost' | 'parallelism'>) =>
  [o.algorithm, o.memoryCost, o.timeCost, o.parallelism].join(',');
const CURRENT = params(PASSWORD_HASH);
const current = (stored: string): boolean => params(parseOptions(stored)) === CURRENT;

/** Built at start-up: making the dummy is one full-cost hash. */
export async function createPasswords(): Promise<Passwords> {
  const dummy = await hash(randomBytes(32).toString('base64url'), PASSWORD_HASH);
  return Object.freeze({
    dummy,
    hash: (password: string) => hash(password.normalize('NFC'), PASSWORD_HASH),
    async verify(stored: string | null, password: string): Promise<Verified> {
      let ok = false;
      try {
        ok = await verify(stored ?? dummy, password.normalize('NFC'));
      } catch {
        // Not an Argon2 hash: a corrupt row refuses the sign-in, it doesn't fail the request.
        ok = false;
      }
      // The dummy never signs anyone in, whatever was typed.
      if (stored === null) return { ok: false, rehash: false };
      return { ok, rehash: ok && !current(stored) };
    },
  });
}
