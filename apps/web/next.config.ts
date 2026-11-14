import type { NextConfig } from 'next';

// RC-146: on every response. The CSP needs a nonce per request, so it is set in proxy.ts.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // A private system: no page is indexed, public token pages included.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  // No URL (a link token included) goes to another site. Not no-referrer: that makes the browser send
  // `Origin: null` on our own writes, which the origin guard (M1-21) refuses.
  { key: 'Referrer-Policy', value: 'same-origin' },
  // A page we open on another site gets no window.opener back, whatever the link or window.open call says.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

// Development and CI have no Caddy, so the browser's /api calls reach the api through Next; deployed, Caddy routes
// /api (ADR-004). An allow-list, like lib-platform's config: an unset, misspelled or 'review' APP_ENV gets no rewrite.
// Next fixes rewrites at `next build`, so the APP_ENV and API_INTERNAL_URL at build time decide, not a later restart.
// So the production web image is built without APP_ENV=ci and API_INTERNAL_URL, and carries no rewrite (auditor on
// #88). Whichever ticket adds that image build keeps it so; Caddy routes /api there.
const DEV_CI = ['development', 'ci'];
const apiRewrites = () => {
  const api = process.env['API_INTERNAL_URL'];
  return DEV_CI.includes(process.env['APP_ENV'] ?? '') && api
    ? [{ source: '/api/:path*', destination: `${api.replace(/\/$/, '')}/:path*` }]
    : [];
};

const config: NextConfig = {
  // ADR-003 §2: files come from S3 by presigned URL, so image optimisation is off and sharp is never loaded.
  images: { unoptimized: true },
  // Next would otherwise write an AGENTS.md into apps/web on every dev start.
  agentRules: false,
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  rewrites: async () => apiRewrites(),
};

export default config;
