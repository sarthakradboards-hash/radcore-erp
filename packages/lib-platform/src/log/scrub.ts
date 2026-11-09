// What a log line may not carry (RC-007): personal data and anything that works as a password. Logs record what
// happened (the error code, the table, the route template, the request id), never what was in it.

// Each shape is replaced by its label. Order matters: a GSTIN holds a PAN, and an email may hold digits.
const SHAPES: [RegExp, string][] = [
  // Whatever follows Bearer or Basic is a credential, digits or not.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, '[gstin]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, '[ifsc]'],
  [/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],
  // An account, card or Aadhaar number: 9 or more digits in a row, maybe grouped by spaces.
  [/\b\d(?:[\s-]?\d){8,}\b/g, '[number]'],
  // A JWT: three base64url parts joined by dots.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]'],
  // A bearer token or a random link token: 24 or more URL-safe characters with a letter and a digit.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, '[token]'],
];

/** A message with every personal-data or token shape replaced by its label. */
export function scrubText(text: string): string {
  return SHAPES.reduce((s, [re, label]) => s.replace(re, label), text);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A route word is short; 20 or more URL-safe characters is a token, with or without a digit. Shorter ones count only
// with a digit, so "invoices" stays a word.
const TOKEN = /^(?:[A-Za-z0-9_-]{20,}|(?=.*\d)[A-Za-z0-9_-]{16,})$/;

/** A request path as a route template, for logs and alert keys: no query string, ids as :id, tokens as :token.
 * The router's own template wins when there is one (M1-08 passes it); this is for paths no route matched. */
export function routeOf(path: string): string {
  return (path.split(/[?#]/)[0] ?? '').split('/')
    .map((seg) => (UUID.test(seg) ? ':id' : TOKEN.test(seg) ? ':token' : /^\d+$/.test(seg) ? ':n' : seg)).join('/');
}
