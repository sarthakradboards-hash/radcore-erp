// Cloudflare Turnstile's server check (RAD-107, Sarthak 20 Nov; ADR-004 §1's "Anti-bot check" row): the token the
// widget gave the browser goes to siteverify, alone, with no visitor address (the architect: more private, and
// Turnstile works without it). A token passes once: Cloudflare refuses it the second time.
import type { Outbound } from '@radcore/lib-platform';
import { z } from 'zod';

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const SITEVERIFY = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
const ANSWER = z.object({ success: z.boolean() });

/** Turnstile's published test secret keys (turnstileSecretFor picks one where no real secret is set): one always passes, one always fails. */
export const TURNSTILE_TEST_SECRETS = { passes: '1x0000000000000000000000000000000AA', fails: '2x0000000000000000000000000000000AA' } as const;

/**
 * The secret the api checks with: TURNSTILE_SECRET wherever it's set. Without it, development and CI use the
 * always-passing test secret, the review copy the always-failing one (its form refuses every enquiry rather than
 * taking any), and anywhere else is refused at start, so no config change can make the captcha always pass
 * (auditor-2 on #274).
 */
export function turnstileSecretFor(appEnv: string, configured: string | null): string {
  if (configured !== null) return configured;
  if (appEnv === 'development' || appEnv === 'ci') return TURNSTILE_TEST_SECRETS.passes;
  if (appEnv === 'review') return TURNSTILE_TEST_SECRETS.fails;
  throw new Error(`TURNSTILE_SECRET is required in ${appEnv}`);
}

/** Whether Cloudflare accepts the token. An unreadable answer, or any status but 200, is a refusal (fail closed). */
export async function turnstilePasses(outbound: Outbound, secret: string, token: string): Promise<boolean> {
  const res = await outbound.request(SITEVERIFY, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }).toString(),
  });
  if (res.status !== 200) return false;
  try {
    const answer = ANSWER.safeParse(JSON.parse(res.body.toString('utf8')));
    return answer.success && answer.data.success;
  } catch {
    return false;
  }
}
