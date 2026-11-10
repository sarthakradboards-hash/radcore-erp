// The write-Origin check (M1-21, RC-165, ADR-001 §7a). The app is one origin (Caddy serves web at / and api at
// /api), so a write is accepted only from PUBLIC_ORIGIN itself. v1 let a request with no Origin through; here a
// write without one is refused. A browser always sends Origin on a cross-site POST, form posts included, which is
// what stops login CSRF on the routes exempt from the Idempotency-Key (ADR-001 §7a): no custom header, no preflight.
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a request may go on: a read always; a write only when its Origin header is exactly the public origin. */
export const originAllowed = (method: string, origin: string | undefined, publicOrigin: string): boolean =>
  READS.has(method.toUpperCase()) || origin === publicOrigin;
