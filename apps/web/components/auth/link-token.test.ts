// RAD-61: a link's token comes from the fragment once, and the address bar no longer shows it.
import { expect, it, vi } from 'vitest';
import { takeLinkToken } from './link-token.ts';

const here = (hash: string) => {
  const replaceState = vi.fn();
  return { here: { location: { hash, pathname: '/invite', search: '?from=mail' }, history: { replaceState, state: null } }, replaceState };
};
// Built at run time from plain words, so no secret scanner mistakes a fixture for a real key.
const TOKEN = ['test', 'link', 'token', 'fixture'].join('-');

it('takes the token and clears the fragment, keeping the path and query', () => {
  const { here: h, replaceState } = here(`#token=${TOKEN}`);
  expect(takeLinkToken(h)).toBe(TOKEN);
  expect(replaceState).toHaveBeenCalledWith(null, '', '/invite?from=mail');
});

it.each([['#token=short'], ['#other=' + TOKEN], ['#token='], [`#token=${'a'.repeat(513)}`]])(
  'answers null for %s, and still clears it', (hash) => {
    const { here: h, replaceState } = here(hash);
    expect(takeLinkToken(h)).toBeNull();
    expect(replaceState).toHaveBeenCalledOnce();
  });

it('leaves the address alone when there is no fragment', () => {
  const { here: h, replaceState } = here('');
  expect(takeLinkToken(h)).toBeNull();
  expect(replaceState).not.toHaveBeenCalled();
});
