// RAD-50 (M1-40, RC-214): the shell reads the session on the server, before the first byte. So a signed-out request
// for a signed-in screen is answered 307 to /sign-in straight away, with no "Loading…" page streamed first and no
// client-side redirect after a 200 (the auditor on #70).
import { expect, test } from './fixtures.ts';

// The sign-in link carries the page asked for as ?next=, so the person lands back on it (RAD-55); Home needs none.
for (const [path, signIn] of [['/', '/sign-in'], ['/admin/users?status=invited', '/sign-in?next=%2Fadmin%2Fusers%3Fstatus%3Dinvited']] as const) {
  test(`signed out, ${path} answers 307 to ${signIn} before any of the screen`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers()['location'] ?? '', 'http://x');
    expect(`${location.pathname}${location.search}`).toBe(signIn);
    // The markup, not Next's inline flight data: that always carries the (app) loading screen's template as a prop,
    // even in a redirect nobody renders. What would show is the markup, and it must hold no loading screen.
    const markup = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '');
    expect(markup).not.toContain('Loading');
  });
}

test('a browser can’t steer the sign-in link: the proxy overwrites a sent asked-path header (RAD-55, RC-097)', async ({ request }) => {
  const res = await request.get('/admin/roles', { maxRedirects: 0, headers: { 'x-radcore-asked-path': '//evil.example' } });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toMatch(/\/sign-in\?next=%2Fadmin%2Froles$/);
});
