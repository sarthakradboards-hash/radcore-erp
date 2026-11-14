// RAD-50 (M1-40, RC-214): the shell reads the session on the server, before the first byte. So a signed-out request
// for a signed-in screen is answered 307 to /sign-in straight away, with no "Loading…" page streamed first and no
// client-side redirect after a 200 (the auditor on #70).
import { expect, test } from './fixtures.ts';

for (const path of ['/', '/admin/users']) {
  test(`signed out, ${path} answers 307 to /sign-in before any of the screen`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(/\/sign-in$/);
    // The markup, not Next's inline flight data: that always carries the (app) loading screen's template as a prop,
    // even in a redirect nobody renders. What would show is the markup, and it must hold no loading screen.
    const markup = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '');
    expect(markup).not.toContain('Loading');
  });
}
