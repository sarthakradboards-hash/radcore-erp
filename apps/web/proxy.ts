import { NextResponse, type NextRequest } from 'next/server';
import { filesOrigin } from './files-origin.ts';

// RC-146. The App Router streams each page's data in inline scripts that differ per request, so the hash list of
// Design notes A-12 (written for v1's two fixed scripts) can't allow them. A fresh nonce per request is the strict
// option: Next reads it from the request's CSP header and stamps it on its own scripts and styles.
// `files` is the files bucket's origin (RAD-43): uploads go there with a presigned POST (connect-src for fetch,
// form-action for a form), and previews come from there (img-src). Exactly that origin, never a wildcard; null adds
// nothing, so a missing setting leaves uploads blocked rather than opening anything.
export function contentSecurityPolicy(nonce: string, dev: boolean, files: string | null = null): string {
  const and = files === null ? '' : ` ${files}`;
  return [
    "default-src 'self'",
    // Dev only: React rebuilds server error stacks with eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Dev only: hot reload injects styles without the nonce.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Style attributes from React style props (Radix, react-virtual) can't run script, so they are allowed. <style>
    // elements still fall under style-src: nonce only (coordinator, PR #20 review).
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data:${and}`,
    "font-src 'self'",
    `connect-src 'self'${and}`,
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${and}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development', filesOrigin(process.env));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: static files and prefetches carry no inline script. The other headers are in next.config.ts.
  matcher: [{
    source: '/((?!_next/static|_next/image|favicon.ico).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }],
  }],
};
