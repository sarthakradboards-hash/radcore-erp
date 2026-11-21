// Meta's webhook proof, which WhatsApp's Cloud API shares (RAD-107): an `X-Hub-Signature-256` HMAC-SHA256 of the raw
// body under the app secret, and the GET handshake that subscribes the endpoint with a verify token.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookCheck } from '@radcore/lib-platform';

/** Equal in constant time, whatever the lengths (a length difference returns false without comparing). */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Whether a delivery carries a signature of the right shape at all: the check before the app secret is read. */
export const hubSigned = (_raw: Buffer, header: (name: string) => string | undefined): boolean =>
  /^sha256=[0-9a-f]{64}$/.test(header('x-hub-signature-256') ?? '');

/** Whether the query is a subscription handshake at all: the check before the verify token is read. */
export const hubAsks = (query: (name: string) => string | undefined): boolean =>
  query('hub.mode') === 'subscribe' && query('hub.challenge') !== undefined && query('hub.verify_token') !== undefined;

/** Checks `sha256=<hex>` against the HMAC of the raw bytes. These providers send no delivery id we can trust in a
 * header, so the intake keys the delivery on its body. A missing secret refuses every delivery. */
export function hubSignature(raw: Buffer, header: (name: string) => string | undefined, secret: string | null): WebhookCheck {
  const sent = header('x-hub-signature-256') ?? '';
  if (secret === null || secret === '' || !sent.startsWith('sha256=')) return { valid: false };
  const want = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return sameSecret(sent, want) ? { valid: true, deliveryId: null } : { valid: false };
}

/** The subscription handshake: Meta's challenge back when the token matches, else null (answered 403). */
export function hubChallenge(query: (name: string) => string | undefined, verifyToken: string | null): string | null {
  const challenge = query('hub.challenge');
  const token = query('hub.verify_token');
  if (query('hub.mode') !== 'subscribe' || challenge === undefined || token === undefined) return null;
  if (verifyToken === null || verifyToken === '' || !sameSecret(token, verifyToken)) return null;
  return challenge;
}
