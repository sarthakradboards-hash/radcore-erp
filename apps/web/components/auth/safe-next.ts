// RC-097: after sign-in, go back only to a page on this site. A crafted ?next= (another site, a protocol-relative
// //host, a backslash or tab trick, javascript:) goes to the home page instead.

/**
 * The path to open after sign-in, given the `next` query value and this site's origin. Always a same-origin path.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  // Browsers treat "\" as "/" in URLs, so "/\evil.example" would leave the site.
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  try {
    // The URL parser also drops tabs and newlines ("/\t/evil.example" becomes "//evil.example"), so check the result.
    const url = new URL(next, origin);
    if (url.origin !== origin) return '/';
    // Dot segments collapse during parsing ("/..//evil.example", "/%2e%2e//evil.example" become "//evil.example"),
    // and a path that starts "//" leaves the site as soon as the browser follows it.
    if (url.pathname.startsWith('//')) return '/';
    // Never back to the sign-in pages themselves, which would loop.
    if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

/** The page the proxy says was asked for (ASKED_PATH_HEADER), set on every page request so a server layout can read it. */
export const ASKED_PATH_HEADER = 'x-radcore-asked-path';

/**
 * Where to send someone who isn't signed in, so they come back to the page they asked for (RAD-55). The path goes
 * through safeNext here as well as on the sign-in page, so a crafted one never even reaches the link. Only the
 * path matters, so any origin will do for the check.
 */
export function signInHref(asked: string | null | undefined): string {
  const next = safeNext(asked, 'https://radcore.invalid');
  return next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
}
