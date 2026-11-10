// The server half of saved-view.ts: a page (a server component) reads the saved choice before the first draw.
import { cookies } from 'next/headers';
import { viewCookie } from './view-cookie.ts';

/** The saved view, if it is one of `choices`; otherwise `fallback`. The cookie is the browser's, so it is checked. */
export async function savedView<V extends string>(name: string, choices: readonly V[], fallback: V): Promise<V> {
  const saved = (await cookies()).get(viewCookie(name))?.value;
  return choices.find((c) => c === saved) ?? fallback;
}
