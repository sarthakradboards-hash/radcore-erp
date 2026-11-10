// Invite and password-reset links carry their token in the URL fragment, `/invite#token=…` (ADR-001 §7a, RAD-61):
// browsers never send a fragment to the server or in Referer, so it stays out of logs. The page takes it once,
// clears it from the address bar (so it isn't left in history, a screenshot or a shared tab), and posts it in a body.

type Here = { location: Pick<Location, 'hash' | 'pathname' | 'search'>; history: Pick<History, 'replaceState' | 'state'> };

/**
 * The link's token, or null when there's none or it can't be one. Clears the fragment either way.
 * @public sign-in screen API: its first callers are RAD-55's invite and password-reset pages.
 */
export function takeLinkToken(here: Here = window): string | null {
  const { location, history } = here;
  if (!location.hash) return null;
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  // The same bounds as the contracts' token field; the server decides whether it is valid.
  return token !== null && token.length >= 16 && token.length <= 512 ? token : null;
}
