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

const config: NextConfig = {
  // ADR-003 §2: files come from S3 by presigned URL, so image optimisation is off and sharp is never loaded.
  images: { unoptimized: true },
  // Next would otherwise write an AGENTS.md into apps/web on every dev start.
  agentRules: false,
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
};

export default config;
