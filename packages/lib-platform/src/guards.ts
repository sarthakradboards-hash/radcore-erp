// The request rate limits (RAD-39, ADR-001 §6 "origin and rate guards", §7a): counted in the shared store (ADR-003,
// RAD-32's rate-limiter-flexible on PostgreSQL), never in process memory, so they hold across restarts and across
// servers (RC-088). Each key is kept only as its HMAC under RATE_LIMIT_KEY (RAD-73). The store fails closed: when it
// can't be reached, the answer is the whole block, so the request is refused.
// - Public and link routes count per client address, for the class their contract names (`rateLimit`).
// - Signed-in routes count per person (RC-194): one person can't flood the API, wherever they sign in from.
// Sized for real customers: an office of people behind one address signing in at nine, a customer opening a few links.
import type { Limiter, LimiterStore } from './db/client.ts';

type Spec = { points: number; windowSeconds: number; blockSeconds: number };

/** Requests per client address, per class, a contract's `rateLimit`. A class not listed here can't be mounted. */
export const ADDRESS_LIMITS = {
  // Sign-in and its second-factor steps. The per-account lockout (M1-14) is the guard against guessing one password;
  // this slows one source trying many accounts.
  'sign-in': { points: 100, windowSeconds: 60, blockSeconds: 60 },
  // Password-reset requests: each may send an email, so far fewer.
  'password-reset': { points: 20, windowSeconds: 3600, blockSeconds: 600 },
  // Invite, reset and public links (RAD-41): a token is 256 bits, so this only keeps a source from hammering.
  'token-link': { points: 120, windowSeconds: 60, blockSeconds: 60 },
  // GET /api/health (ADR-004 §2), which touches the database: the outside monitor checks a few times a minute.
  'health': { points: 60, windowSeconds: 60, blockSeconds: 60 },
} as const satisfies Record<string, Spec>;

/** Requests per signed-in person, over every route (RC-194): a busy screen makes tens a minute, never hundreds. */
export const PERSON_LIMIT = { points: 600, windowSeconds: 60, blockSeconds: 60 } as const satisfies Spec;

export type RateLimitClass = keyof typeof ADDRESS_LIMITS;
export const isRateLimitClass = (c: string): c is RateLimitClass => Object.hasOwn(ADDRESS_LIMITS, c);

/** Each answer is how many seconds the caller must wait: 0 when the request may go. Every call counts one request. */
export type RequestGuards = {
  address(rateLimit: RateLimitClass, address: string): Promise<number>;
  person(userId: string): Promise<number>;
};

export function createRequestGuards(store: LimiterStore): RequestGuards {
  const byClass = new Map<string, Limiter>(Object.entries(ADDRESS_LIMITS)
    .map(([c, spec]) => [c, store.limiter({ prefix: `address:${c}`, ...spec })]));
  const person = store.limiter({ prefix: 'person', ...PERSON_LIMIT });
  return Object.freeze({
    address: (rateLimit: RateLimitClass, address: string) => {
      const limiter = byClass.get(rateLimit);
      if (limiter === undefined) throw new TypeError(`${rateLimit}: not a rate-limit class`);
      return limiter.hit(address);
    },
    person: (userId: string) => person.hit(userId),
  });
}
