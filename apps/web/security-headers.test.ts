// RC-146 (M1-46): the headers on every response and the per-request CSP. The new-tab link rule is in
// tools/eslint-config.test.ts.
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import config from './next.config';
import { contentSecurityPolicy, proxy } from './proxy';

describe('headers on every response', () => {
  it('applies the full set to every path', async () => {
    expect(await config.headers?.()).toEqual([{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    ] }]);
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('content security policy', () => {
  it('allows no inline script, eval or un-nonced <style> in production; style attributes only', () => {
    expect(contentSecurityPolicy('abc', false)).toBe([
      "default-src 'self'", "script-src 'self' 'nonce-abc' 'strict-dynamic'", "style-src 'self' 'nonce-abc'",
      "style-src-attr 'unsafe-inline'", "img-src 'self' blob: data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
      "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
  });

  it('loosens only scripts (eval) and styles (inline) in development', () => {
    const dev = contentSecurityPolicy('abc', true);
    expect(dev).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval';");
    expect(dev).toContain("style-src 'self' 'unsafe-inline';");
    expect(dev.replace("style-src-attr 'unsafe-inline'", '').replace(/'unsafe-(eval|inline)'/g, '')).not.toContain('unsafe');
  });

  it('allows the files bucket origin for uploads and previews, in exactly three directives (RAD-43)', () => {
    const files = 'https://radcore-files.s3.ap-south-1.amazonaws.com';
    const csp = contentSecurityPolicy('abc', false, files);
    expect(csp).toContain(`img-src 'self' blob: data: ${files};`);
    expect(csp).toContain(`connect-src 'self' ${files};`);
    expect(csp).toContain(`form-action 'self' ${files};`);
    expect(csp.split(files)).toHaveLength(4);
    expect(csp.replaceAll(` ${files}`, '')).toBe(contentSecurityPolicy('abc', false));
  });

  it('reads the origin from S3_FILES_ORIGIN, and adds nothing when it is not a bare origin', () => {
    const cspWith = (value: string) => {
      vi.stubEnv('APP_ENV', 'production');
      vi.stubEnv('S3_FILES_ORIGIN', value);
      return proxy(new NextRequest('http://127.0.0.1:3000/')).headers.get('content-security-policy') ?? '';
    };
    try {
      expect(cspWith('https://radcore-files.s3.ap-south-1.amazonaws.com'))
        .toContain("connect-src 'self' https://radcore-files.s3.ap-south-1.amazonaws.com;");
      expect(cspWith('https://*.amazonaws.com')).toContain("connect-src 'self';");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('gives each request its own nonce, on the response and on the request Next renders', () => {
    const nonces = [1, 2].map(() => {
      const res = proxy(new NextRequest('http://127.0.0.1:3000/l/some-token'));
      const csp = res.headers.get('content-security-policy') ?? '';
      // NextResponse.next({ request }) hands the changed request headers to the renderer this way.
      expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
      return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    });
    expect(nonces[0]).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});
