// Every piece of screen text goes through t() (RC-217). English only for now; Hindi (A-11) adds a second catalogue
// with the same keys, and the type below makes a missing key a compile error.
const en = {
  'error.title': 'Something went wrong',
  'error.body': 'Your unsaved typing is kept as a draft on this device. Try again, and if it keeps happening, give your admin the reference below.',
  'error.reference': 'Reference: {id}',
  'error.retry': 'Try again',
  'notFound.title': 'Page not found',
  'notFound.body': 'The page may have moved, or the link may be wrong.',
  'notFound.home': 'Go to the home page',
  'loading': 'Loading…',
  'browser.title': 'Please update your browser',
  'browser.body': 'RadCore needs Chrome or Edge 123, Safari 17.5 or Firefox 120, or newer. Your work is safe: update, then sign in again.',
} as const;

export type MessageKey = keyof typeof en;

/** The English text for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: MessageKey, vars: Readonly<Record<string, string>> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}
